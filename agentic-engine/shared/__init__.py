"""
Shared utilities for the agentic-engine Lambda functions.

Available clients:
  BedrockClient   — Amazon Bedrock (Claude 3.5 Sonnet) via bedrock-runtime
  DynamoDBClient  — DynamoDB read/write helpers

Removed (no longer part of the architecture):
  AppSyncClient   — replaced by direct DynamoDB writes from the pipeline
  OpenSearchClient — replaced by Amazon Bedrock Knowledge Base
"""

from .bedrock_client import BedrockClient
from .dynamodb_client import DynamoDBClient

__all__ = ["BedrockClient", "DynamoDBClient"]
