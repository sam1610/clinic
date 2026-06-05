"""DynamoDB client for reading and writing clinical data."""

import boto3
from typing import Dict, List, Optional, Any
from datetime import datetime
from botocore.exceptions import ClientError


class DynamoDBClient:
    """Client for interacting with DynamoDB tables."""

    def __init__(self, region: str = "eu-central-1"):
        """
        Initialize DynamoDB client.

        Args:
            region: AWS region for DynamoDB
        """
        self.client = boto3.client("dynamodb", region_name=region)
        self.resource = boto3.resource("dynamodb", region_name=region)

    def get_item(self, table_name: str, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get an item from DynamoDB.

        Args:
            table_name: Name of the DynamoDB table
            key: Primary key of the item

        Returns:
            Item data or None if not found
        """
        try:
            table = self.resource.Table(table_name)
            response = table.get_item(Key=key)
            return response.get("Item")
        except ClientError as e:
            print(f"Error getting item from DynamoDB: {e}")
            return None

    def put_item(self, table_name: str, item: Dict[str, Any]) -> bool:
        """
        Put an item into DynamoDB.

        Args:
            table_name: Name of the DynamoDB table
            item: Item data to insert

        Returns:
            True if successful, False otherwise
        """
        try:
            table = self.resource.Table(table_name)
            table.put_item(Item=item)
            return True
        except ClientError as e:
            print(f"Error putting item to DynamoDB: {e}")
            return False

    def update_item(
        self,
        table_name: str,
        key: Dict[str, Any],
        updates: Dict[str, Any],
    ) -> bool:
        """
        Update an item in DynamoDB.

        Args:
            table_name: Name of the DynamoDB table
            key: Primary key of the item
            updates: Dictionary of attributes to update

        Returns:
            True if successful, False otherwise
        """
        try:
            table = self.resource.Table(table_name)

            # Build update expression
            update_expression = "SET "
            expression_attribute_values = {}
            expression_attribute_names = {}

            for i, (attr_name, attr_value) in enumerate(updates.items()):
                placeholder = f":val{i}"
                name_placeholder = f"#{attr_name}"

                if i > 0:
                    update_expression += ", "

                update_expression += f"{name_placeholder} = {placeholder}"
                expression_attribute_values[placeholder] = attr_value
                expression_attribute_names[name_placeholder] = attr_name

            # Add updatedAt timestamp
            update_expression += ", #updatedAt = :updatedAt"
            expression_attribute_values[":updatedAt"] = datetime.utcnow().isoformat()
            expression_attribute_names["#updatedAt"] = "updatedAt"

            table.update_item(
                Key=key,
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expression_attribute_values,
                ExpressionAttributeNames=expression_attribute_names,
            )
            return True
        except ClientError as e:
            print(f"Error updating item in DynamoDB: {e}")
            return False

    def query_by_index(
        self,
        table_name: str,
        index_name: str,
        key_condition: str,
        expression_values: Dict[str, Any],
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Query DynamoDB using a secondary index.

        Args:
            table_name: Name of the DynamoDB table
            index_name: Name of the GSI
            key_condition: Key condition expression
            expression_values: Expression attribute values
            limit: Maximum number of items to return

        Returns:
            List of items matching the query
        """
        try:
            table = self.resource.Table(table_name)
            response = table.query(
                IndexName=index_name,
                KeyConditionExpression=key_condition,
                ExpressionAttributeValues=expression_values,
                Limit=limit,
            )
            return response.get("Items", [])
        except ClientError as e:
            print(f"Error querying DynamoDB: {e}")
            return []

    def scan_table(
        self,
        table_name: str,
        filter_expression: Optional[str] = None,
        expression_values: Optional[Dict[str, Any]] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Scan a DynamoDB table.

        Args:
            table_name: Name of the DynamoDB table
            filter_expression: Optional filter expression
            expression_values: Optional expression attribute values
            limit: Maximum number of items to return

        Returns:
            List of items from the scan
        """
        try:
            table = self.resource.Table(table_name)

            scan_kwargs = {"Limit": limit}
            if filter_expression:
                scan_kwargs["FilterExpression"] = filter_expression
            if expression_values:
                scan_kwargs["ExpressionAttributeValues"] = expression_values

            response = table.scan(**scan_kwargs)
            return response.get("Items", [])
        except ClientError as e:
            print(f"Error scanning DynamoDB: {e}")
            return []
