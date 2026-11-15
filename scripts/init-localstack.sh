#!/bin/bash
echo "Initializing LocalStack SQS queues..."

# Create Dead Letter Queue FIFO
awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

# Get DLQ ARN
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

# Create Main Queue FIFO with RedrivePolicy pointing to DLQ (maxReceiveCount = 3)
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"3\"}"

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "FifoQueue=true,ContentBasedDeduplication=false,RedrivePolicy='${REDRIVE_POLICY}'"

echo "SQS Queues initialized successfully!"
