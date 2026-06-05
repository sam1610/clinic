"""AppSync GraphQL client for executing mutations."""

import json
import boto3
import requests
from typing import Dict, Any, Optional
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


class AppSyncClient:
    """Client for executing AppSync GraphQL mutations."""

    def __init__(self, appsync_endpoint: str, region: str = "eu-central-1"):
        """
        Initialize AppSync client.

        Args:
            appsync_endpoint: AppSync GraphQL endpoint URL
            region: AWS region
        """
        self.endpoint = appsync_endpoint
        self.region = region
        self.session = boto3.Session()

    def execute_mutation(
        self, mutation: str, variables: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Execute a GraphQL mutation.

        Args:
            mutation: GraphQL mutation string
            variables: Optional variables for the mutation

        Returns:
            Response data from AppSync
        """
        # Prepare request body
        body = {"query": mutation}
        if variables:
            body["variables"] = variables

        # Create AWS request
        request = AWSRequest(
            method="POST",
            url=self.endpoint,
            data=json.dumps(body),
            headers={"Content-Type": "application/json"},
        )

        # Sign request with SigV4
        credentials = self.session.get_credentials()
        SigV4Auth(credentials, "appsync", self.region).add_auth(request)

        # Execute request
        response = requests.post(
            request.url,
            headers=dict(request.headers),
            data=request.body,
        )

        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(
                f"AppSync mutation failed: {response.status_code} - {response.text}"
            )

    def create_patient_summary(
        self,
        summary_id: str,
        patient_record_id: str,
        summary_text: str,
        diagnostic_suggestions: list[str],
        risk_level: str,
        agent_type: str,
        agent_version: str = "1.0.0",
        embedding_id: Optional[str] = None,
        similar_cases_count: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Create a PatientSummary record via AppSync mutation.

        Args:
            summary_id: Unique summary identifier
            patient_record_id: Patient record ID
            summary_text: Generated summary text
            diagnostic_suggestions: List of diagnostic suggestions
            risk_level: Risk level (Low, Medium, High)
            agent_type: Type of agent (summarization-agent, diagnostic-agent)
            agent_version: Agent version
            embedding_id: Optional OpenSearch embedding ID
            similar_cases_count: Optional count of similar cases

        Returns:
            Created PatientSummary record
        """
        mutation = """
        mutation CreatePatientSummary($input: CreatePatientSummaryInput!) {
          createPatientSummary(input: $input) {
            id
            summaryId
            patientRecordId
            summaryText
            diagnosticSuggestions
            riskLevel
            agentType
            agentVersion
            generatedAt
            embeddingId
            similarCasesCount
          }
        }
        """

        variables = {
            "input": {
                "summaryId": summary_id,
                "patientRecordId": patient_record_id,
                "summaryText": summary_text,
                "diagnosticSuggestions": diagnostic_suggestions,
                "riskLevel": risk_level,
                "agentType": agent_type,
                "agentVersion": agent_version,
                "generatedAt": None,  # Will be auto-generated
            }
        }

        if embedding_id:
            variables["input"]["embeddingId"] = embedding_id
        if similar_cases_count is not None:
            variables["input"]["similarCasesCount"] = similar_cases_count

        response = self.execute_mutation(mutation, variables)
        return response.get("data", {}).get("createPatientSummary", {})

    def update_patient_summary(
        self,
        summary_id: str,
        updates: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Update a PatientSummary record via AppSync mutation.

        Args:
            summary_id: Summary ID to update
            updates: Dictionary of fields to update

        Returns:
            Updated PatientSummary record
        """
        mutation = """
        mutation UpdatePatientSummary($input: UpdatePatientSummaryInput!) {
          updatePatientSummary(input: $input) {
            id
            summaryId
            summaryText
            diagnosticSuggestions
            riskLevel
            embeddingId
            similarCasesCount
            updatedAt
          }
        }
        """

        variables = {"input": {"id": summary_id, **updates}}

        response = self.execute_mutation(mutation, variables)
        return response.get("data", {}).get("updatePatientSummary", {})
