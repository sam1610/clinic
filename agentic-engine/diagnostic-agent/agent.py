"""Diagnostic Agent using Claude 3.5 Sonnet with OpenSearch tool."""

import json
import os
from datetime import datetime
from typing import Dict, Any, List, Optional
from shared.bedrock_client import BedrockClient
from shared.dynamodb_client import DynamoDBClient
from shared.appsync_client import AppSyncClient
from shared.opensearch_client import OpenSearchClient


class DiagnosticAgent:
    """
    AI agent for generating diagnostic suggestions and risk assessments.

    Triggered by: Manual invocation or scheduled job
    Model: Amazon Bedrock (Claude 3.5 Sonnet)
    Tools: OpenSearch for retrieving similar historical cases
    Output: Diagnostic findings saved to PatientSummary table
    """

    SYSTEM_PROMPT = """You are an expert clinical diagnostician and psychologist specializing in comprehensive patient assessment.

Your role is to:
1. Review extracted clinical entities and patient summaries
2. Formulate diagnostic suggestions based on symptoms, conditions, and medications
3. Flag high-risk psychological markers for the attending psychologist
4. Leverage similar historical cases to improve diagnostic accuracy

Guidelines:
1. **Evidence-Based**: Base diagnoses on clinical evidence and similar cases
2. **Differential Diagnosis**: Consider multiple possible diagnoses when appropriate
3. **Psychological Risk**: Identify markers for depression, anxiety, suicidal ideation, or other mental health concerns
4. **Severity Assessment**: Evaluate the urgency and severity of the patient's condition
5. **Recommendations**: Provide clear next steps for the healthcare team

Risk Levels:
- **Low**: Routine conditions, no immediate concerns, stable mental health
- **Medium**: Chronic conditions requiring monitoring, mild psychological symptoms
- **High**: Acute conditions, severe symptoms, or significant psychological risk markers

Psychological Risk Markers:
- Expressions of hopelessness or worthlessness
- Suicidal ideation or self-harm mentions
- Severe anxiety or panic symptoms
- Significant mood changes or depression indicators
- Social isolation or withdrawal
- Substance abuse concerns

You have access to a tool to search for similar historical cases in OpenSearch. Use this tool to find relevant precedents that can inform your diagnostic assessment.

Output Format:
Provide your response as a JSON object with the following structure:
{
  "diagnostic_suggestions": ["diagnosis1", "diagnosis2", ...],
  "risk_level": "Low|Medium|High",
  "psychological_risk_markers": ["marker1", "marker2", ...],
  "differential_diagnoses": ["possible_diagnosis1", "possible_diagnosis2", ...],
  "recommendations": ["recommendation1", "recommendation2", ...],
  "similar_cases_analysis": "Analysis of similar historical cases and their relevance"
}"""

    def __init__(
        self,
        region: str = "us-east-1",
        appsync_endpoint: Optional[str] = None,
        opensearch_endpoint: Optional[str] = None,
    ):
        """
        Initialize Diagnostic Agent.

        Args:
            region: AWS region for Bedrock
            appsync_endpoint: AppSync GraphQL endpoint URL
            opensearch_endpoint: OpenSearch endpoint URL
        """
        self.bedrock = BedrockClient(region=region)
        self.dynamodb = DynamoDBClient(region=os.environ.get("AWS_REGION", "eu-central-1"))
        self.appsync = AppSyncClient(
            appsync_endpoint=appsync_endpoint or os.environ.get("APPSYNC_ENDPOINT"),
            region=os.environ.get("AWS_REGION", "eu-central-1"),
        )

        # Initialize OpenSearch if endpoint provided
        self.opensearch = None
        if opensearch_endpoint or os.environ.get("OPENSEARCH_ENDPOINT"):
            self.opensearch = OpenSearchClient(
                endpoint=opensearch_endpoint or os.environ.get("OPENSEARCH_ENDPOINT"),
                region=os.environ.get("AWS_REGION", "eu-central-1"),
            )

        self.clinical_entities_table = os.environ.get(
            "CLINICAL_ENTITIES_TABLE", "ClinicalEntities"
        )
        self.patient_summary_table = os.environ.get(
            "PATIENT_SUMMARY_TABLE", "PatientSummary"
        )

    def process_patient_case(
        self,
        patient_record_id: str,
        interaction_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process a patient case and generate diagnostic assessment.

        Args:
            patient_record_id: Patient record ID
            interaction_id: Optional specific interaction ID

        Returns:
            Diagnostic assessment data
        """
        print(f"Processing diagnostic assessment for patient: {patient_record_id}")

        # Get clinical entities for this patient
        entities_records = self._get_patient_entities(patient_record_id, interaction_id)

        if not entities_records:
            raise ValueError(f"No clinical entities found for patient: {patient_record_id}")

        # Get existing summaries
        summaries = self._get_patient_summaries(patient_record_id)

        # Build user message
        user_message = self._build_user_message(entities_records, summaries)

        # Define OpenSearch tool
        tools = self._define_tools()

        # Define tool handlers
        tool_handlers = {
            "search_similar_cases": self._search_similar_cases_handler,
        }

        # Invoke Claude with tool loop
        print("Invoking Claude 3.5 Sonnet for diagnostic assessment...")
        response = self.bedrock.invoke_with_tool_loop(
            system_prompt=self.SYSTEM_PROMPT,
            user_message=user_message,
            tools=tools,
            tool_handlers=tool_handlers,
            max_iterations=3,
        )

        # Extract text content
        diagnostic_text = self.bedrock.extract_text_content(response)

        # Parse JSON response
        try:
            diagnostic_data = json.loads(diagnostic_text)
        except json.JSONDecodeError:
            # Fallback if Claude doesn't return valid JSON
            diagnostic_data = {
                "diagnostic_suggestions": ["Review required"],
                "risk_level": "Medium",
                "psychological_risk_markers": [],
                "differential_diagnoses": [],
                "recommendations": ["Comprehensive evaluation recommended"],
                "similar_cases_analysis": diagnostic_text,
            }

        # Generate summary ID
        summary_id = f"DIAG-{int(datetime.utcnow().timestamp() * 1000)}"

        # Save to PatientSummary table via AppSync
        print(f"Saving diagnostic assessment to PatientSummary table: {summary_id}")
        patient_summary = self.appsync.create_patient_summary(
            summary_id=summary_id,
            patient_record_id=patient_record_id,
            summary_text=diagnostic_data.get("similar_cases_analysis", diagnostic_text),
            diagnostic_suggestions=diagnostic_data.get("diagnostic_suggestions", []),
            risk_level=diagnostic_data.get("risk_level", "Medium"),
            agent_type="diagnostic-agent",
            agent_version="1.0.0",
            similar_cases_count=len(diagnostic_data.get("similar_cases", [])) if "similar_cases" in diagnostic_data else None,
        )

        print(f"Diagnostic assessment created successfully: {patient_summary.get('id')}")

        return {
            "summary_id": summary_id,
            "patient_record_id": patient_record_id,
            "risk_level": diagnostic_data.get("risk_level"),
            "diagnostic_suggestions": diagnostic_data.get("diagnostic_suggestions"),
            "psychological_risk_markers": diagnostic_data.get("psychological_risk_markers"),
        }

    def _get_patient_entities(
        self,
        patient_record_id: str,
        interaction_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get clinical entities for a patient."""
        # This would typically query by patient_record_id
        # For now, we'll scan the table (in production, use a GSI)
        entities = self.dynamodb.scan_table(
            table_name=self.clinical_entities_table,
            limit=10,
        )
        return entities

    def _get_patient_summaries(self, patient_record_id: str) -> List[Dict[str, Any]]:
        """Get existing summaries for a patient."""
        summaries = self.dynamodb.scan_table(
            table_name=self.patient_summary_table,
            limit=5,
        )
        return summaries

    def _build_user_message(
        self,
        entities_records: List[Dict[str, Any]],
        summaries: List[Dict[str, Any]],
    ) -> str:
        """Build user message for Claude."""
        message = "Please provide a comprehensive diagnostic assessment based on the following patient data:\n\n"

        # Add entities
        message += "**Clinical Entities:**\n"
        for i, entities in enumerate(entities_records, 1):
            message += f"\nInteraction {i}:\n"
            message += f"- Symptoms: {', '.join(entities.get('symptoms', []))}\n"
            message += f"- Medications: {', '.join(entities.get('medications', []))}\n"
            message += f"- Conditions: {', '.join(entities.get('conditions', []))}\n"
            message += f"- Procedures: {', '.join(entities.get('procedures', []))}\n"

        # Add existing summaries
        if summaries:
            message += "\n**Previous Summaries:**\n"
            for i, summary in enumerate(summaries, 1):
                message += f"\nSummary {i}:\n"
                message += f"{summary.get('summaryText', '')[:500]}\n"

        message += "\nPlease use the search_similar_cases tool to find relevant historical cases, then provide your diagnostic assessment in JSON format."

        return message

    def _define_tools(self) -> List[Dict[str, Any]]:
        """Define tools for Claude."""
        return [
            {
                "name": "search_similar_cases",
                "description": "Search for similar historical cases in OpenSearch based on symptoms. Use this to find relevant precedents that can inform diagnostic assessment.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "symptoms": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of symptoms to search for",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of cases to return (default: 5)",
                            "default": 5,
                        },
                    },
                    "required": ["symptoms"],
                },
            }
        ]

    def _search_similar_cases_handler(
        self,
        symptoms: List[str],
        limit: int = 5,
    ) -> Dict[str, Any]:
        """
        Tool handler for searching similar cases.

        Args:
            symptoms: List of symptoms to search for
            limit: Maximum number of results

        Returns:
            Similar cases data
        """
        if not self.opensearch:
            return {
                "error": "OpenSearch not configured",
                "cases": [],
            }

        print(f"Searching for similar cases with symptoms: {symptoms}")

        try:
            results = self.opensearch.search_by_symptoms(symptoms, k=limit)

            cases = []
            for result in results:
                source = result.get("source", {})
                cases.append(
                    {
                        "case_id": result.get("id"),
                        "similarity_score": result.get("score"),
                        "symptoms": source.get("symptoms", []),
                        "diagnosis": source.get("diagnosis", "Unknown"),
                        "summary": source.get("summary_text", "")[:200],
                    }
                )

            return {
                "cases": cases,
                "count": len(cases),
            }

        except Exception as e:
            print(f"Error searching similar cases: {e}")
            return {
                "error": str(e),
                "cases": [],
            }
