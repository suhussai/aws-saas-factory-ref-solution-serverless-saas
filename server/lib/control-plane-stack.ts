import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CognitoAuth, ControlPlane } from '@cdklabs/sbt-aws';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import * as moesif from 'sbt-aws-moesif';

interface ControlPlaneStackProps extends cdk.StackProps {
  systemAdminEmail: string;
  moesifCredentials: {
    moesifApplicationId: string;
    moesifManagementAPIKey: string;
    billingProviderSecretKey: string;
  };
}

export class ControlPlaneStack extends cdk.Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventBusArn: string;
  public readonly moesifBilling: moesif.MoesifBilling;

  constructor(scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);

    const cognitoAuth = new CognitoAuth(this, 'CognitoAuth', {
      setAPIGWScopes: false, // done for testing purposes. Scopes should be used for added security in production!
    });

    this.moesifBilling = new moesif.MoesifBilling(this, 'MoesifBilling', {
      moesifApplicationId: props.moesifCredentials.moesifApplicationId,
      moesifManagementAPIKey: props.moesifCredentials.moesifManagementAPIKey,
      billingProviderSlug: moesif.BillingProviderSlug.STRIPE,
      billingProviderSecretKey: props.moesifCredentials.billingProviderSecretKey,
    });

    const controlPlane = new ControlPlane(this, 'ControlPlane', {
      auth: cognitoAuth,
      systemAdminEmail: props.systemAdminEmail,
      billing: this.moesifBilling,
      apiCorsConfig: {
        allowOrigins: ['https://*'],
        allowCredentials: true,
        allowHeaders: ['*'],
        allowMethods: [cdk.aws_apigatewayv2.CorsHttpMethod.ANY],
        maxAge: cdk.Duration.seconds(300),
      },
    });

    const eventBus = EventBus.fromEventBusArn(this, 'eventBus', controlPlane.eventManager.busArn)

    // for monitoring purposes
    new Rule(this, 'EventBusWatcherRule', {
      eventBus: eventBus,
      enabled: true,
      eventPattern: {
        source: [
          controlPlane.eventManager.controlPlaneEventSource,
          controlPlane.eventManager.applicationPlaneEventSource,
        ],
      },
    });

    new LogGroup(this, 'EventBusWatcherLogGroup', {
      logGroupName: `/aws/events/EventBusWatcher-${this.node.addr}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_WEEK,
    });

    this.eventBusArn = controlPlane.eventManager.busArn;
    this.regApiGatewayUrl = controlPlane.controlPlaneAPIGatewayUrl;
  }
}
