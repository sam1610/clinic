"""Lambda handler for Diagnostic Agent."""

import json
import os
from typing import Dict, Any
from .agent import DiagnosticAgent


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for Diagnostic Agent.

    Can be triggered by:
    1. EventBridge scheduled rule (batch processing)
    2. Manual invocation with patient_record_id
    3. API Gateway request

    Event structure:
    {
      "patient_record_id": "PAT-12345",
      "interaction_id": "INT-67890"  # Optional
    }

    Args:
        event: Lambda event
        context: Lambda context

    Returns:
        Response with diagnostic assessment
    """
    print(f"Received event: {json.dumps(event)}")

    # Initialize agent
    agent = DiagnosticAgent(
        region=os.environ.get("BEDROCK_REGION", "us-east-1"),
        appsync_endpoint=os.environ.get("APPSYNC_ENDPOINT"),
        opensearch_endpoint=os.environ.get("OPENSEARCH_ENDPOINT"),
    )

    # Extract patient_record_id from event
    patient_record_id = event.get("patient_record_id")
    interaction_id = event.get("interaction_id")

    if not patient_record_id:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "patient_record_id is required"}),
        }

    try:
        # Process patient case and generate diagnostic assessment
        result = agent.process_patient_case(
            patient_record_id=patient_record_id,
            interaction_id=interaction_id,
        )

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "message": "Diagnostic assessment completed",
                    "summary_id": result.get("summary_id"),
                    "risk_level": result.get("risk_level"),
                    "diagnostic_suggestions": result.get("diagnostic_suggestions"),
                    "psychological_risk_markers": result.get("psychological_risk_markers"),
                }
            ),
        }

    except Exception as e:
        print(f"Error processing diagnostic assessment: {e}")
        return {
            "statusCode": 500,
            "body": json.dumps(
                {
                    "error": "Failed to process diagnostic assessment",
                    "details": str(e),
                }
            ),
        }
