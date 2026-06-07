#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClinicalIngestionStack } from '../lib/clinical-ingestion-stack';
import { BedrockKnowledgeBaseStack } from '../lib/bedrock-knowledge-base-stack';

const app = new cdk.App();

const env = {
  account: '770961405135',
  region: 'us-east-1',
};

// ── 1. Call Recordings Bucket ────────────────────────────────────────────
new ClinicalIngestionStack(app, 'ClinicalIngestionStack', {
  env,
  description: 'Secure S3 bucket for Amazon Connect call recordings',
});

// ── 2. Bedrock Knowledge Base + CTR Post-Processor ───────────────────────
new BedrockKnowledgeBaseStack(app, 'BedrockKnowledgeBaseStack', {
  env,
  description:
    'Bedrock Knowledge Base (medical guidelines) + SaveHistoricalInteraction Lambda',
  historicalInteractionTableName:
    'HistoricalInteraction-xbseoxrhxfa4tpsomwm3meyily-NONE',
  historicalInteractionTableArn:
    'arn:aws:dynamodb:us-east-1:770961405135:table/HistoricalInteraction-xbseoxrhxfa4tpsomwm3meyily-NONE',
});
