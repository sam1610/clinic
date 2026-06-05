#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClinicalIngestionStack } from '../lib/clinical-ingestion-stack';
import { VectorSearchStack } from '../lib/vector-search-stack';

const app = new cdk.App();

// Clinical Ingestion Stack (Transcribe + Comprehend)
new ClinicalIngestionStack(app, 'ClinicalIngestionStack', {
  env: {
    account: '770961405135',
    region: 'us-east-1',
  },
  description: 'Clinical audio and text processing pipeline with Transcribe Medical and Comprehend Medical',
  clinicalInteractionTableName: 'ClinicalInteraction-xbseoxrhxfa4tpsomwm3meyily-NONE',
  clinicalEntitiesTableName: 'ClinicalEntities-xbseoxrhxfa4tpsomwm3meyily-NONE',
});

// Vector Search Stack (OpenSearch Serverless + Titan Embeddings)
new VectorSearchStack(app, 'VectorSearchStack', {
  env: {
    account: '770961405135',
    region: 'us-east-1',
  },
  description: 'Vector search system for clinical case similarity using OpenSearch Serverless',
  patientSummaryTableName: 'PatientSummary-xbseoxrhxfa4tpsomwm3meyily-NONE',
  patientSummaryTableArn:  'arn:aws:dynamodb:us-east-1:770961405135:table/PatientSummary-xbseoxrhxfa4tpsomwm3meyily-NONE',
  patientSummaryStreamArn: 'arn:aws:dynamodb:us-east-1:770961405135:table/PatientSummary-xbseoxrhxfa4tpsomwm3meyily-NONE/stream/2026-06-03T13:04:08.491',
});
