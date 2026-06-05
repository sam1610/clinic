"""Lambda handler for Summarization Agent."""

import json
import os
from typing import Dict, Any
from .agent import SummarizationAgent


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler triggered by DynamoDB Stream.

    Event structure:
    {
      "Records": [
        {
          "eventName": "INSERT",
          "dynamodb": {
            "NewImage": { ... },
            "Keys": { ... }
          }
        }
      ]
    }

    Args:
        event: DynamoDB Stream event
        context: Lambda context

    Returns:
        Response with processing results
    """
    print(f"Received event: {json.dumps(event)}")

    # Initialize agent
    agent = SummarizationAgent(
        region=os.environ.get("BEDROCK_REGION", "us-east-1"),
        appsync_endpoint=os.environ.get("APPSYNC_ENDPOINT"),
    )

    results = []

    # Process each record from DynamoDB Stream
    for record in event.get("Records", []):
        event_name = record.get("eventName")

        # Only process INSERT events (new ClinicalEntities records)
        if event_name != "INSERT":
            print(f"Skipping event: {event_name}")
            continue

        # Extract new image from DynamoDB Stream
        new_image = record.get("dynamodb", {}).get("NewImage", {})

        if not new_image:
            print("No new image found in record")
            continue

        # Convert DynamoDB format to Python dict
        entities_record = deserialize_dynamodb_item(new_image)

        try:
            # Process entities and generate summary
            result = agent.process_entities(entities_record)
            results.append(
                {
                    "status": "success",
                    "entity_id": entities_record.get("entityId"),
                    "summary_id": result.get("summary_id"),
                }
            )
            print(f"Successfully processed entity: {entities_record.get('entityId')}")

        except Exception as e:
            print(f"Error processing entity: {e}")
            results.append(
                {
                    "status": "error",
                    "entity_id": entities_record.get("entityId"),
                    "error": str(e),
                }
            )

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": f"Processed {len(results)} records",
                "results": results,
            }
        ),
    }


def deserialize_dynamodb_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert DynamoDB Stream format to Python dict.

    Args:
        item: DynamoDB item in stream format

    Returns:
        Python dictionary
    """
    result = {}

    for key, value in item.items():
        if "S" in value:
            result[key] = value["S"]
        elif "N" in value:
            result[key] = int(value["N"]) if "." not in value["N"] else float(value["N"])
        elif "BOOL" in value:
            result[key] = value["BOOL"]
        elif "L" in value:
            result[key] = [deserialize_dynamodb_value(v) for v in value["L"]]
        elif "M" in value:
            result[key] = deserialize_dynamodb_item(value["M"])
        elif "NULL" in value:
            result[key] = None

    return result


def deserialize_dynamodb_value(value: Dict[str, Any]) -> Any:
    """
    Deserialize a single DynamoDB value.

    Args:
        value: DynamoDB value

    Returns:
        Python value
    """
    if "S" in value:
        return value["S"]
    elif "N" in value:
        return int(value["N"]) if "." not in value["N"] else float(value["N"])
    elif "BOOL" in value:
        return value["BOOL"]
    elif "L" in value:
        return [deserialize_dynamodb_value(v) for v in value["L"]]
    elif "M" in value:
        return deserialize_dynamodb_item(value["M"])
    elif "NULL" in value:
        return None
    return None
