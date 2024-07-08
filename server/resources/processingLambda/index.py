from aws_lambda_powertools.utilities.data_classes.cloud_watch_logs_event import CloudWatchLogsDecodedData
from aws_lambda_powertools.utilities.data_classes import event_source, CloudWatchLogsEvent
import json
import boto3
import os
import datetime
import uuid

firehose_client = boto3.client('firehose')
firehose_stream_arn = os.environ['FIREHOSE_STREAM_ARN']


@event_source(data_class=CloudWatchLogsEvent)
def handler(event: CloudWatchLogsEvent, context):
    firehose_stream_name = firehose_stream_arn.split('/')[-1]

    decompressed_log: CloudWatchLogsDecodedData = event.parse_logs_data()
    log_events = decompressed_log.log_events
    for event in log_events:
        print(event)
        transformed_data = transform_payload(event, str(uuid.uuid4()))
        print(transformed_data)
        firehose_client.put_record(
            DeliveryStreamName=firehose_stream_name,
            Record={
                'Data': json.dumps(transformed_data)
            }
        )


def transform_payload(event, transaction_id):
    payload = json.loads(event.message)
    log_event_id = event.get_id

    # Initialize metadata
    metadata = {
        'service': payload["service"],
        'source': 'kinesis',
        'log_event_id': log_event_id,
    }

    # Extract metrics
    for metric in payload["_aws"]["CloudWatchMetrics"][0]["Metrics"]:
        metric_name = metric["Name"]

        # Assuming the value is in the payload with the same key as the metric name
        metric_value = payload.get(metric_name, [None])[0]
        if metric_value is not None:
            metadata[metric_name] = metric_value

    transformed = {
        "action_name": f"Processed Transaction for {payload["service"]}",
        "request": {
            "time": str(datetime.datetime.now(tz=datetime.timezone.utc).replace(microsecond=0).isoformat())
        },
        "company_id": payload["tenant_id"],
        "transaction_id": transaction_id,
        "metadata": metadata
    }
    return transformed
