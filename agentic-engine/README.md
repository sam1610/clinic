# Agentic Engine - Clinical AI Agents

Python-based AI agents using Amazon Bedrock (Claude 3.5 Sonnet) and the Strands SDK for clinical summarization and diagnostics.

## Architecture

```
DynamoDB Stream (ClinicalEntities)
         ↓
Lambda: Summarization Agent
         ↓
Amazon Bedrock (Claude 3.5 Sonnet)
         ↓
AppSync Mutation → PatientSummary Table
         ↓
Lambda: Diagnostic Agent (triggered manually or scheduled)
         ↓
Amazon Bedrock + OpenSearch Tool
         ↓
AppSync Mutation → PatientSummary Table (diagnostic findings)
```

## Agents

### 1. Summarization Agent

**Purpose**: Generate structured clinical summaries from extracted entities

**Trigger**: DynamoDB Stream on ClinicalEntities table (INSERT events)

**Model**: Amazon Bedrock - Claude 3.5 Sonnet

**Process**:
1. Receives new ClinicalEntities record from DynamoDB Stream
2. Fetches associated ClinicalInteraction (transcript)
3. Sends entities + transcript to Claude for summarization
4. Generates structured summary with risk assessment
5. Saves to PatientSummary table via AppSync mutation

**Output**:
- Clinical summary text
- Risk level (Low/Medium/High)
- Key findings
- Recommendations

### 2. Diagnostic Agent

**Purpose**: Generate diagnostic suggestions and flag psychological risk markers

**Trigger**: Manual invocation or EventBridge scheduled rule

**Model**: Amazon Bedrock - Claude 3.5 Sonnet

**Tools**:
- `search_similar_cases`: Query OpenSearch for similar historical cases

**Process**:
1. Receives patient_record_id
2. Fetches all ClinicalEntities and existing summaries
3. Uses Claude with OpenSearch tool to find similar cases
4. Generates diagnostic assessment with psychological risk markers
5. Saves to PatientSummary table via AppSync mutation

**Output**:
- Diagnostic suggestions
- Differential diagnoses
- Psychological risk markers
- Risk level assessment
- Similar cases analysis
- Recommendations

## Project Structure

```
agentic-engine/
├── shared/
│   ├── __init__.py
│   ├── bedrock_client.py          # Claude 3.5 Sonnet client
│   ├── dynamodb_client.py         # DynamoDB operations
│   ├── appsync_client.py          # GraphQL mutations
│   └── opensearch_client.py       # Vector similarity search
├── summarization-agent/
│   ├── __init__.py
│   ├── agent.py                   # Summarization logic
│   └── handler.py                 # Lambda handler
├── diagnostic-agent/
│   ├── __init__.py
│   ├── agent.py                   # Diagnostic logic with tools
│   └── handler.py                 # Lambda handler
├── pyproject.toml                 # Python dependencies
├── .env.example                   # Environment variables template
└── README.md                      # This file
```

## Prerequisites

1. **Python 3.10+** installed
2. **uv** package manager installed
3. **AWS Account** with Bedrock access
4. **Amplify Gen 2 Backend** deployed (for DynamoDB tables)
5. **Amazon Bedrock** model access enabled (Claude 3.5 Sonnet)

## Installation

### 1. Install Dependencies

```bash
cd agentic-engine
uv sync
```

This will install:
- `boto3` - AWS SDK
- `botocore` - AWS core library
- `pydantic` - Data validation
- `python-dotenv` - Environment variables
- `opensearchpy` - OpenSearch client (for Diagnostic Agent)
- `requests` - HTTP client (for AppSync)

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

Required environment variables:
- `AWS_REGION`: AWS region for DynamoDB/AppSync
- `BEDROCK_REGION`: AWS region for Bedrock (us-east-1 recommended)
- `CLINICAL_ENTITIES_TABLE`: DynamoDB table name from Amplify
- `CLINICAL_INTERACTION_TABLE`: DynamoDB table name from Amplify
- `PATIENT_SUMMARY_TABLE`: DynamoDB table name from Amplify
- `APPSYNC_ENDPOINT`: AppSync GraphQL endpoint URL

Optional:
- `OPENSEARCH_ENDPOINT`: OpenSearch endpoint for similar case search

### 3. Enable Bedrock Model Access

```bash
# Enable Claude 3.5 Sonnet in Bedrock console
aws bedrock list-foundation-models --region us-east-1 \
  --query 'modelSummaries[?contains(modelId, `claude-3-5-sonnet`)].modelId'

# Request model access if not already enabled
# Go to AWS Console → Bedrock → Model access → Request access
```

## Deployment

### Option 1: Deploy with AWS SAM/CDK

Create a CDK stack to deploy both Lambda functions:

```typescript
// In clinical-ingestion or separate stack
const summarizationFunction = new lambda.Function(this, 'SummarizationAgent', {
  runtime: lambda.Runtime.PYTHON_3_10,
  handler: 'summarization-agent.handler.lambda_handler',
  code: lambda.Code.fromAsset('path/to/agentic-engine'),
  timeout: cdk.Duration.minutes(5),
  memorySize: 1024,
  environment: {
    BEDROCK_REGION: 'us-east-1',
    APPSYNC_ENDPOINT: appsyncEndpoint,
    CLINICAL_ENTITIES_TABLE: entitiesTable.tableName,
    // ... other env vars
  },
});

// Add DynamoDB Stream trigger
entitiesTable.grantStreamRead(summarizationFunction);
summarizationFunction.addEventSource(
  new DynamoEventSource(entitiesTable, {
    startingPosition: lambda.StartingPosition.LATEST,
    batchSize: 10,
    retryAttempts: 2,
  })
);
```

### Option 2: Deploy Manually

1. **Package the code**:
```bash
cd agentic-engine
zip -r agents.zip . -x "*.pyc" -x "__pycache__/*" -x ".env"
```

2. **Create Lambda functions** in AWS Console:
   - Runtime: Python 3.10
   - Handler: `summarization-agent.handler.lambda_handler`
   - Timeout: 5 minutes
   - Memory: 1024 MB

3. **Configure DynamoDB Stream trigger**:
   - Source: ClinicalEntities table
   - Batch size: 10
   - Starting position: Latest

4. **Add IAM permissions**:
   - Bedrock: `bedrock:InvokeModel`
   - DynamoDB: `dynamodb:GetItem`, `dynamodb:PutItem`
   - AppSync: `appsync:GraphQL`
   - OpenSearch: `aoss:APIAccessAll` (for Diagnostic Agent)

## Testing

### Test Summarization Agent Locally

```python
from summarization_agent.agent import SummarizationAgent

agent = SummarizationAgent(
    region="us-east-1",
    appsync_endpoint="https://your-endpoint.appsync-api.eu-central-1.amazonaws.com/graphql"
)

# Mock entities record
entities_record = {
    "id": "ENT-123",
    "entityId": "ENT-123",
    "clinicalInteractionId": "INT-456",
    "symptoms": ["headache", "fever"],
    "medications": ["ibuprofen"],
    "conditions": [],
    "procedures": []
}

result = agent.process_entities(entities_record)
print(result)
```

### Test Diagnostic Agent Locally

```python
from diagnostic_agent.agent import DiagnosticAgent

agent = DiagnosticAgent(
    region="us-east-1",
    appsync_endpoint="https://your-endpoint.appsync-api.eu-central-1.amazonaws.com/graphql",
    opensearch_endpoint="your-opensearch-endpoint.aoss.amazonaws.com"
)

result = agent.process_patient_case(patient_record_id="PAT-123")
print(result)
```

### Test with Lambda Event

```bash
# Test Summarization Agent
aws lambda invoke \
  --function-name clinical-summarization-agent \
  --payload file://test-events/dynamodb-stream-event.json \
  response.json

# Test Diagnostic Agent
aws lambda invoke \
  --function-name clinical-diagnostic-agent \
  --payload '{"patient_record_id": "PAT-123"}' \
  response.json
```

## Integration with Clinical Ingestion Stack

The agents integrate with the Clinical Ingestion Stack:

1. **Comprehend Lambda** writes to ClinicalEntities table
2. **DynamoDB Stream** triggers Summarization Agent
3. **Summarization Agent** writes to PatientSummary table
4. **Diagnostic Agent** reads from PatientSummary and writes back

## OpenSearch Setup (Optional)

For the Diagnostic Agent's similar case search:

### 1. Create OpenSearch Serverless Collection

```bash
aws opensearchserverless create-collection \
  --name clinical-cases \
  --type VECTORSEARCH \
  --region eu-central-1
```

### 2. Create Index

```python
from shared.opensearch_client import OpenSearchClient

client = OpenSearchClient(
    endpoint="your-endpoint.aoss.amazonaws.com",
    region="eu-central-1"
)

client.create_index(dimension=1536)  # For text-embedding-ada-002
```

### 3. Index Historical Cases

```python
# Index a case
client.index_document(
    doc_id="CASE-001",
    embedding=[0.1, 0.2, ...],  # 1536-dim vector
    metadata={
        "patient_id": "PAT-001",
        "symptoms": ["headache", "fever"],
        "diagnosis": "Viral infection",
        "summary_text": "Patient presented with...",
        "timestamp": "2024-01-15T10:30:00Z"
    }
)
```

## Monitoring

### CloudWatch Logs

```bash
# Summarization Agent logs
aws logs tail /aws/lambda/clinical-summarization-agent --follow

# Diagnostic Agent logs
aws logs tail /aws/lambda/clinical-diagnostic-agent --follow
```

### CloudWatch Metrics

- Lambda invocations
- Lambda errors
- Lambda duration
- Bedrock API calls
- DynamoDB read/write capacity

### Alarms

Create alarms for:
- Lambda errors > 5 in 5 minutes
- Lambda duration > 4 minutes (approaching timeout)
- Bedrock throttling errors

## Cost Estimation

### Per 1000 Summaries

- **Bedrock (Claude 3.5 Sonnet)**: ~$15 (input: 2K tokens, output: 1K tokens)
- **Lambda**: ~$0.50 (1024MB, 30s avg)
- **DynamoDB**: ~$0.25 (writes to PatientSummary)
- **AppSync**: ~$0.10 (mutations)

**Total**: ~$15.85 per 1000 summaries

### Per 1000 Diagnostic Assessments

- **Bedrock (Claude 3.5 Sonnet)**: ~$20 (with tool calls)
- **OpenSearch**: ~$5 (vector searches)
- **Lambda**: ~$1 (1024MB, 60s avg)
- **DynamoDB**: ~$0.50 (reads + writes)

**Total**: ~$26.50 per 1000 assessments

## Troubleshooting

### Issue: Bedrock Access Denied

**Solution**: Enable model access in Bedrock console:
```bash
aws bedrock list-foundation-models --region us-east-1
# Request access for Claude 3.5 Sonnet
```

### Issue: AppSync Mutation Fails

**Solution**: Verify IAM permissions and endpoint URL:
```bash
aws appsync list-graphql-apis --region eu-central-1
```

### Issue: DynamoDB Stream Not Triggering

**Solution**: Verify stream is enabled and Lambda has permissions:
```bash
aws dynamodb describe-table --table-name ClinicalEntities-...
```

### Issue: OpenSearch Connection Fails

**Solution**: Verify data access policy and network access:
```bash
aws opensearchserverless get-access-policy --name clinical-cases-policy
```

## Security

### IAM Permissions

Summarization Agent needs:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-*"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:*:*:table/Clinical*"
    },
    {
      "Effect": "Allow",
      "Action": ["appsync:GraphQL"],
      "Resource": "arn:aws:appsync:*:*:apis/*/types/Mutation/*"
    }
  ]
}
```

### Data Privacy

- All data encrypted in transit (HTTPS)
- DynamoDB encryption at rest
- Bedrock does not store prompts or responses
- OpenSearch encryption enabled

## Next Steps

1. ✅ Agents scaffolded and configured
2. ⏭️ Deploy Lambda functions
3. ⏭️ Configure DynamoDB Stream trigger
4. ⏭️ Set up OpenSearch collection
5. ⏭️ Test end-to-end pipeline
6. ⏭️ Build React UI for viewing summaries
7. ⏭️ Add monitoring and alerting

## Support

- [Amazon Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Strands SDK Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)
- [OpenSearch Serverless](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless.html)
