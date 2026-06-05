# Clinical Ingestion Stack - Deployment Guide

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build Lambda functions
cd functions/transcribe-medical && npm install && npm run build && cd ../..
cd functions/comprehend-medical && npm install && npm run build && cd ../..

# 3. Configure AWS credentials
export AWS_PROFILE=your-profile
export AWS_REGION=eu-central-1

# 4. Bootstrap CDK (first time only)
npx cdk bootstrap

# 5. Deploy
npm run deploy
```

## Detailed Steps

### Step 1: Prerequisites

Ensure you have:
- ✅ AWS Account with admin permissions
- ✅ AWS CLI installed and configured
- ✅ Node.js 18.x or later
- ✅ Amplify Gen 2 backend deployed (for DynamoDB table names)

### Step 2: Get DynamoDB Table Names

From your Amplify deployment, get the table names:

**Option 1: From amplify_outputs.json**
```bash
cd ../clinical-frontend
cat amplify_outputs.json | grep -A 5 "data"
```

**Option 2: From AWS Console**
1. Go to AWS Console → DynamoDB → Tables
2. Find tables starting with `ClinicalInteraction-` and `ClinicalEntities-`
3. Note the full table names

**Option 3: From AWS CLI**
```bash
aws dynamodb list-tables --query 'TableNames[?contains(@, `ClinicalInteraction`)]'
aws dynamodb list-tables --query 'TableNames[?contains(@, `ClinicalEntities`)]'
```

### Step 3: Configure Stack

Edit `bin/clinical-ingestion.ts`:

```typescript
new ClinicalIngestionStack(app, 'ClinicalIngestionStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-central-1', // or us-east-1
  },
  // Add your table names here
  clinicalInteractionTableName: 'ClinicalInteraction-abc123xyz-main',
  clinicalEntitiesTableName: 'ClinicalEntities-abc123xyz-main',
});
```

### Step 4: Install Dependencies

```bash
# Install CDK dependencies
npm install

# Install Transcribe Lambda dependencies
cd functions/transcribe-medical
npm install
npm run build
cd ../..

# Install Comprehend Lambda dependencies
cd functions/comprehend-medical
npm install
npm run build
cd ../..
```

### Step 5: Bootstrap CDK (First Time Only)

```bash
# Bootstrap for your account and region
npx cdk bootstrap aws://ACCOUNT-ID/REGION

# Example
npx cdk bootstrap aws://123456789012/eu-central-1
```

### Step 6: Review Changes

```bash
# Synthesize CloudFormation template
npm run synth

# Review what will be deployed
npm run diff
```

### Step 7: Deploy

```bash
npm run deploy
```

This will create:
- S3 bucket for call recordings
- 2 Lambda functions (Transcribe, Comprehend)
- 2 EventBridge rules
- IAM roles and policies
- CloudWatch log groups

**Deployment time**: ~3-5 minutes

### Step 8: Note the Outputs

After deployment, you'll see outputs like:

```
Outputs:
ClinicalIngestionStack.RecordingsBucketName = clinical-call-recordings-123456789012-eu-central-1
ClinicalIngestionStack.RecordingsBucketArn = arn:aws:s3:::clinical-call-recordings-123456789012-eu-central-1
ClinicalIngestionStack.TranscribeFunctionArn = arn:aws:lambda:eu-central-1:123456789012:function:clinical-transcribe-medical
ClinicalIngestionStack.ComprehendFunctionArn = arn:aws:lambda:eu-central-1:123456789012:function:clinical-comprehend-medical
```

**Save these values** - you'll need them for Amazon Connect configuration.

## Testing the Pipeline

### Test 1: Upload a Recording

```bash
# Get bucket name
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name ClinicalIngestionStack \
  --query 'Stacks[0].Outputs[?OutputKey==`RecordingsBucketName`].OutputValue' \
  --output text)

# Upload test file
aws s3 cp test-recording.wav s3://$BUCKET_NAME/recordings/test-contact-123/recording.wav
```

### Test 2: Monitor Execution

```bash
# Watch Transcribe Lambda logs
aws logs tail /aws/lambda/clinical-transcribe-medical --follow

# In another terminal, watch Comprehend Lambda logs
aws logs tail /aws/lambda/clinical-comprehend-medical --follow
```

### Test 3: Verify DynamoDB Records

```bash
# Check ClinicalInteraction table
aws dynamodb scan \
  --table-name ClinicalInteraction-abc123xyz-main \
  --max-items 5

# Check ClinicalEntities table
aws dynamodb scan \
  --table-name ClinicalEntities-abc123xyz-main \
  --max-items 5
```

## Integration with Amazon Connect

### Step 1: Configure Call Recording Storage

1. Go to **Amazon Connect Console**
2. Select your instance
3. Go to **Data Storage** → **Call Recordings**
4. Click **Edit**
5. Enter the S3 bucket name from stack outputs
6. Set prefix: `recordings/`
7. Enable encryption
8. Save

### Step 2: Update Contact Flow

In your Amazon Connect contact flow:

1. Add **Set recording behavior** block
2. Enable recording
3. Set recording location: S3 bucket
4. Connect to your call flow

### Step 3: Test End-to-End

1. Make a test call through Amazon Connect
2. Speak some medical terms (e.g., "Patient has headache and fever")
3. End the call
4. Wait 2-3 minutes for processing
5. Check DynamoDB for the transcript and entities

## Monitoring

### CloudWatch Dashboard

Create a dashboard to monitor:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name ClinicalIngestionPipeline \
  --dashboard-body file://dashboard.json
```

### CloudWatch Alarms

Create alarms for failures:

```bash
# Lambda errors alarm
aws cloudwatch put-metric-alarm \
  --alarm-name clinical-transcribe-errors \
  --alarm-description "Alert on Transcribe Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=clinical-transcribe-medical
```

## Troubleshooting

### Issue: CDK Bootstrap Failed

**Error**: `This stack uses assets, so the toolkit stack must be deployed`

**Solution**:
```bash
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

### Issue: Lambda Deployment Failed

**Error**: `Cannot find module '@aws-sdk/client-transcribe'`

**Solution**: Build Lambda functions first:
```bash
cd functions/transcribe-medical
npm install
npm run build
```

### Issue: DynamoDB Access Denied

**Error**: `User is not authorized to perform: dynamodb:PutItem`

**Solution**: Verify table names in `bin/clinical-ingestion.ts` match your Amplify tables.

### Issue: Transcribe Job Fails

**Error**: `The audio file could not be read`

**Solution**: Verify audio format:
- Supported: WAV, MP3, MP4, FLAC
- Sample rate: 8000-48000 Hz
- Max size: 2 GB

### Issue: EventBridge Rule Not Triggering

**Solution**: Verify EventBridge notifications are enabled on S3 bucket:
```bash
aws s3api get-bucket-notification-configuration \
  --bucket $BUCKET_NAME
```

## Cost Optimization

### 1. Adjust Lambda Memory

For lower costs, reduce Lambda memory:

```typescript
// In lib/clinical-ingestion-stack.ts
memorySize: 256, // Instead of 512/1024
```

### 2. Enable S3 Intelligent-Tiering

```typescript
lifecycleRules: [
  {
    transitions: [
      {
        storageClass: s3.StorageClass.INTELLIGENT_TIERING,
        transitionAfter: cdk.Duration.days(30),
      },
    ],
  },
],
```

### 3. Use Reserved Capacity for DynamoDB

If you have predictable traffic, switch to provisioned capacity.

## Security Hardening

### 1. Enable S3 Access Logging

```typescript
const logBucket = new s3.Bucket(this, 'LogBucket', {
  encryption: s3.BucketEncryption.S3_MANAGED,
});

this.recordingsBucket.logAccessTo(logBucket);
```

### 2. Enable CloudTrail

```bash
aws cloudtrail create-trail \
  --name clinical-ingestion-trail \
  --s3-bucket-name my-cloudtrail-bucket
```

### 3. Rotate IAM Credentials

Use AWS Secrets Manager for any API keys or credentials.

## Updating the Stack

### Update Lambda Code

```bash
# Update function code
cd functions/transcribe-medical
# Make changes to index.ts
npm run build
cd ../..

# Deploy changes
npm run deploy
```

### Update Stack Configuration

```bash
# Make changes to lib/clinical-ingestion-stack.ts
npm run diff  # Review changes
npm run deploy
```

## Rollback

If deployment fails:

```bash
# Rollback to previous version
aws cloudformation cancel-update-stack --stack-name ClinicalIngestionStack

# Or delete and redeploy
npm run destroy
npm run deploy
```

## Cleanup

To remove all resources:

```bash
# Delete stack
npm run destroy

# Manually delete S3 bucket if it has objects
aws s3 rm s3://$BUCKET_NAME --recursive
aws s3 rb s3://$BUCKET_NAME
```

## Next Steps

1. ✅ Deploy Clinical Ingestion Stack
2. ⏭️ Configure Amazon Connect to use the S3 bucket
3. ⏭️ Test with real call recordings
4. ⏭️ Build Agentic Engine for AI summaries
5. ⏭️ Create React UI for monitoring

## Support

For issues or questions:
- Check CloudWatch Logs
- Review AWS documentation
- Contact AWS Support

## Useful Commands

```bash
# Deploy
npm run deploy

# Destroy
npm run destroy

# Diff
npm run diff

# Synth
npm run synth

# Watch
npm run watch

# View logs
aws logs tail /aws/lambda/clinical-transcribe-medical --follow
aws logs tail /aws/lambda/clinical-comprehend-medical --follow

# List stacks
aws cloudformation list-stacks

# Describe stack
aws cloudformation describe-stacks --stack-name ClinicalIngestionStack
```
