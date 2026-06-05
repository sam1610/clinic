"""Summarization Agent using Claude 3.5 Sonnet."""

import json
import os
from datetime import datetime
from typing import Dict, Any, List
from shared.bedrock_client import BedrockClient
from shared.dynamodb_client import DynamoDBClient
from shared.appsync_client import AppSyncClient


class SummarizationAgent:
    """
    AI agent for generating clinical summaries from extracted entities.

    Triggered by: DynamoDB Stream when new ClinicalEntities record is created
    Model: Amazon Bedrock (Claude 3.5 Sonnet)
    Output: Structured clinical summary saved to PatientSummary table
    """

    SYSTEM_PROMPT = """You are an expert clinical AI assistant specializing in medical documentation and summarization.

Your role is to analyze extracted clinical entities from patient interactions and generate comprehensive, structured clinical summaries.

Guidelines:
1. **Accuracy**: Base your summary strictly on the provided entities. Do not invent or assume information.
2. **Structure**: Organize the summary into clear sections (Chief Complaint, Symptoms, Medications, Assessment).
3. **Clarity**: Use clear, professional medical terminology appropriate for healthcare providers.
4. **Completeness**: Include all relevant symptoms, medications, conditions, and procedures mentioned.
5. **Risk Assessment**: Evaluate the overall risk level based on the severity and combination of symptoms.

Risk Levels:
- **Low**: Minor symptoms, routine conditions, no immediate concerns
- **Medium**: Moderate symptoms, chronic conditions requiring monitoring
- **High**: Severe symptoms, acute conditions, or combinations suggesting serious illness

Output Format:
Provide your response as a JSON object with the following structure:
{
  "summary": "Detailed clinical summary text",
  "risk_level": "Low|Medium|High",
  "key_findings": ["finding1", "finding2", ...],
  "recommendations": ["recommendation1", "recommendation2", ...]
}"""

    def __init__(
        self,
        region: str = "us-east-1",
        appsync_endpoint: Optional[str] = None,
    ):
        """
        Initialize Summarization Agent.

        Args:
            region: AWS region for Bedrock
            appsync_endpoint: AppSync GraphQL endpoint URL
        """
        self.bedrock = BedrockClient(region=region)
        self.dynamodb = DynamoDBClient(region=os.environ.get("AWS_REGION", "eu-central-1"))
        self.appsync = AppSyncClient(
            appsync_endpoint=appsync_endpoint or os.environ.get("APPSYNC_ENDPOINT"),
            region=os.environ.get("AWS_REGION", "eu-central-1"),
        )

        self.clinical_interaction_table = os.environ.get(
            "CLINICAL_INTERACTION_TABLE", "ClinicalInteraction"
        )
        self.patient_record_table = os.environ.get(
            "PATIENT_RECORD_TABLE", "PatientRecord"
        )

    def process_entities(self, entities_record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a ClinicalEntities record and generate a summary.

        Args:
            entities_record: ClinicalEntities record from DynamoDB

        Returns:
            Generated summary data
        """
        print(f"Processing entities record: {entities_record.get('id')}")

        # Extract entity data
        entity_id = entities_record.get("entityId")
        interaction_id = entities_record.get("clinicalInteractionId")
        symptoms = entities_record.get("symptoms", [])
        medications = entities_record.get("medications", [])
        conditions = entities_record.get("conditions", [])
        procedures = entities_record.get("procedures", [])

        # Get the associated clinical interaction for transcript
        interaction = self.dynamodb.get_item(
            table_name=self.clinical_interaction_table,
            key={"id": interaction_id},
        )

        if not interaction:
            raise ValueError(f"Clinical interaction not found: {interaction_id}")

        transcript = interaction.get("transcriptText", "")
        patient_record_id = interaction.get("patientRecordId", "UNKNOWN")

        # Build user message for Claude
        user_message = self._build_user_message(
            transcript=transcript,
            symptoms=symptoms,
            medications=medications,
            conditions=conditions,
            procedures=procedures,
        )

        # Invoke Claude to generate summary
        print("Invoking Claude 3.5 Sonnet for summarization...")
        response = self.bedrock.invoke(
            system_prompt=self.SYSTEM_PROMPT,
            user_message=user_message,
            max_tokens=2048,
            temperature=0.3,  # Lower temperature for more consistent summaries
        )

        # Extract text content
        summary_text = self.bedrock.extract_text_content(response)

        # Parse JSON response
        try:
            summary_data = json.loads(summary_text)
        except json.JSONDecodeError:
            # Fallback if Claude doesn't return valid JSON
            summary_data = {
                "summary": summary_text,
                "risk_level": "Medium",
                "key_findings": symptoms,
                "recommendations": ["Review with attending physician"],
            }

        # Generate summary ID
        summary_id = f"SUM-{int(datetime.utcnow().timestamp() * 1000)}"

        # Save to PatientSummary table via AppSync
        print(f"Saving summary to PatientSummary table: {summary_id}")
        patient_summary = self.appsync.create_patient_summary(
            summary_id=summary_id,
            patient_record_id=patient_record_id,
            summary_text=summary_data.get("summary", summary_text),
            diagnostic_suggestions=summary_data.get("key_findings", symptoms),
            risk_level=summary_data.get("risk_level", "Medium"),
            agent_type="summarization-agent",
            agent_version="1.0.0",
        )

        print(f"Summary created successfully: {patient_summary.get('id')}")

        return {
            "summary_id": summary_id,
            "patient_record_id": patient_record_id,
            "interaction_id": interaction_id,
            "risk_level": summary_data.get("risk_level"),
            "summary": summary_data.get("summary"),
        }

    def _build_user_message(
        self,
        transcript: str,
        symptoms: List[str],
        medications: List[str],
        conditions: List[str],
        procedures: List[str],
    ) -> str:
        """
        Build user message for Claude with entity data.

        Args:
            transcript: Full transcript text
            symptoms: List of symptoms
            medications: List of medications
            conditions: List of conditions
            procedures: List of procedures

        Returns:
            Formatted user message
        """
        message = f"""Please generate a comprehensive clinical summary based on the following patient interaction data:

**Transcript:**
{transcript[:2000]}  # Limit transcript length

**Extracted Clinical Entities:**

**Symptoms:**
{', '.join(symptoms) if symptoms else 'None identified'}

**Medications:**
{', '.join(medications) if medications else 'None mentioned'}

**Conditions:**
{', '.join(conditions) if conditions else 'None identified'}

**Procedures:**
{', '.join(procedures) if procedures else 'None mentioned'}

Please provide a structured clinical summary with risk assessment in JSON format."""

        return message
