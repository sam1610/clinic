"""Amazon OpenSearch client for vector similarity search."""

import boto3
import json
from typing import Dict, List, Any, Optional
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth


class OpenSearchClient:
    """Client for interacting with Amazon OpenSearch Serverless."""

    def __init__(
        self,
        endpoint: str,
        region: str = "eu-central-1",
        index_name: str = "clinical-cases",
    ):
        """
        Initialize OpenSearch client.

        Args:
            endpoint: OpenSearch endpoint URL
            region: AWS region
            index_name: Name of the OpenSearch index
        """
        self.endpoint = endpoint
        self.region = region
        self.index_name = index_name

        # Get AWS credentials
        credentials = boto3.Session().get_credentials()
        auth = AWSV4SignerAuth(credentials, region, "aoss")

        # Create OpenSearch client
        self.client = OpenSearch(
            hosts=[{"host": endpoint, "port": 443}],
            http_auth=auth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            pool_maxsize=20,
        )

    def create_index(self, dimension: int = 1536) -> bool:
        """
        Create an OpenSearch index with vector field.

        Args:
            dimension: Dimension of the embedding vectors

        Returns:
            True if successful
        """
        index_body = {
            "settings": {"index": {"knn": True, "knn.algo_param.ef_search": 512}},
            "mappings": {
                "properties": {
                    "embedding": {
                        "type": "knn_vector",
                        "dimension": dimension,
                        "method": {
                            "name": "hnsw",
                            "space_type": "cosinesimil",
                            "engine": "nmslib",
                            "parameters": {"ef_construction": 512, "m": 16},
                        },
                    },
                    "patient_id": {"type": "keyword"},
                    "interaction_id": {"type": "keyword"},
                    "summary_text": {"type": "text"},
                    "symptoms": {"type": "keyword"},
                    "medications": {"type": "keyword"},
                    "conditions": {"type": "keyword"},
                    "diagnosis": {"type": "text"},
                    "timestamp": {"type": "date"},
                }
            },
        }

        try:
            response = self.client.indices.create(
                index=self.index_name, body=index_body
            )
            return response.get("acknowledged", False)
        except Exception as e:
            print(f"Error creating index: {e}")
            return False

    def index_document(
        self,
        doc_id: str,
        embedding: List[float],
        metadata: Dict[str, Any],
    ) -> bool:
        """
        Index a document with its embedding.

        Args:
            doc_id: Unique document ID
            embedding: Vector embedding
            metadata: Document metadata

        Returns:
            True if successful
        """
        document = {"embedding": embedding, **metadata}

        try:
            response = self.client.index(
                index=self.index_name, id=doc_id, body=document
            )
            return response.get("result") in ["created", "updated"]
        except Exception as e:
            print(f"Error indexing document: {e}")
            return False

    def search_similar_cases(
        self,
        query_embedding: List[float],
        k: int = 5,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search for similar cases using vector similarity.

        Args:
            query_embedding: Query vector embedding
            k: Number of results to return
            filters: Optional filters to apply

        Returns:
            List of similar cases with scores
        """
        query = {
            "size": k,
            "query": {
                "knn": {
                    "embedding": {
                        "vector": query_embedding,
                        "k": k,
                    }
                }
            },
        }

        # Add filters if provided
        if filters:
            query["query"] = {
                "bool": {
                    "must": [query["query"]],
                    "filter": [{"term": {key: value}} for key, value in filters.items()],
                }
            }

        try:
            response = self.client.search(index=self.index_name, body=query)
            hits = response.get("hits", {}).get("hits", [])

            results = []
            for hit in hits:
                result = {
                    "id": hit["_id"],
                    "score": hit["_score"],
                    "source": hit["_source"],
                }
                results.append(result)

            return results
        except Exception as e:
            print(f"Error searching similar cases: {e}")
            return []

    def search_by_symptoms(
        self,
        symptoms: List[str],
        k: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Search for cases with similar symptoms.

        Args:
            symptoms: List of symptoms to search for
            k: Number of results to return

        Returns:
            List of matching cases
        """
        query = {
            "size": k,
            "query": {
                "bool": {
                    "should": [{"term": {"symptoms": symptom}} for symptom in symptoms],
                    "minimum_should_match": 1,
                }
            },
        }

        try:
            response = self.client.search(index=self.index_name, body=query)
            hits = response.get("hits", {}).get("hits", [])

            results = []
            for hit in hits:
                result = {
                    "id": hit["_id"],
                    "score": hit["_score"],
                    "source": hit["_source"],
                }
                results.append(result)

            return results
        except Exception as e:
            print(f"Error searching by symptoms: {e}")
            return []

    def delete_document(self, doc_id: str) -> bool:
        """
        Delete a document from the index.

        Args:
            doc_id: Document ID to delete

        Returns:
            True if successful
        """
        try:
            response = self.client.delete(index=self.index_name, id=doc_id)
            return response.get("result") == "deleted"
        except Exception as e:
            print(f"Error deleting document: {e}")
            return False
