"""Amazon Bedrock client for Claude 3.5 Sonnet."""

import json
import boto3
from typing import Dict, List, Optional, Any
from botocore.exceptions import ClientError


class BedrockClient:
    """Client for interacting with Amazon Bedrock (Claude 3.5 Sonnet)."""

    def __init__(self, region: str = "us-east-1"):
        """
        Initialize Bedrock client.

        Args:
            region: AWS region for Bedrock (default: us-east-1)
        """
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = "anthropic.claude-3-5-sonnet-20241022-v2:0"

    def invoke(
        self,
        system_prompt: str,
        user_message: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Invoke Claude 3.5 Sonnet with a message.

        Args:
            system_prompt: System prompt to set agent behavior
            user_message: User message to process
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature (0-1)
            tools: Optional list of tools for function calling

        Returns:
            Response from Claude including content and tool calls
        """
        request_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_message}],
        }

        # Add tools if provided
        if tools:
            request_body["tools"] = tools

        try:
            response = self.client.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
            )

            response_body = json.loads(response["body"].read())
            return response_body

        except ClientError as e:
            print(f"Error invoking Bedrock: {e}")
            raise

    def invoke_with_tool_loop(
        self,
        system_prompt: str,
        user_message: str,
        tools: List[Dict[str, Any]],
        tool_handlers: Dict[str, callable],
        max_iterations: int = 5,
    ) -> Dict[str, Any]:
        """
        Invoke Claude with tools and handle tool calls in a loop.

        Args:
            system_prompt: System prompt
            user_message: Initial user message
            tools: List of tool definitions
            tool_handlers: Dict mapping tool names to handler functions
            max_iterations: Maximum number of tool call iterations

        Returns:
            Final response from Claude
        """
        messages = [{"role": "user", "content": user_message}]
        iterations = 0

        while iterations < max_iterations:
            # Invoke Claude
            response = self.invoke(
                system_prompt=system_prompt,
                user_message=messages[-1]["content"],
                tools=tools,
            )

            # Check if Claude wants to use a tool
            if response.get("stop_reason") == "tool_use":
                # Extract tool calls
                tool_calls = [
                    block
                    for block in response.get("content", [])
                    if block.get("type") == "tool_use"
                ]

                if not tool_calls:
                    break

                # Execute tool calls
                tool_results = []
                for tool_call in tool_calls:
                    tool_name = tool_call["name"]
                    tool_input = tool_call["input"]
                    tool_id = tool_call["id"]

                    # Execute tool handler
                    if tool_name in tool_handlers:
                        try:
                            result = tool_handlers[tool_name](**tool_input)
                            tool_results.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": tool_id,
                                    "content": json.dumps(result),
                                }
                            )
                        except Exception as e:
                            tool_results.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": tool_id,
                                    "content": json.dumps({"error": str(e)}),
                                    "is_error": True,
                                }
                            )

                # Add assistant response and tool results to messages
                messages.append({"role": "assistant", "content": response["content"]})
                messages.append({"role": "user", "content": tool_results})

                iterations += 1
            else:
                # No more tool calls, return final response
                return response

        return response

    def extract_text_content(self, response: Dict[str, Any]) -> str:
        """
        Extract text content from Claude response.

        Args:
            response: Response from Claude

        Returns:
            Extracted text content
        """
        content_blocks = response.get("content", [])
        text_blocks = [
            block["text"] for block in content_blocks if block.get("type") == "text"
        ]
        return "\n".join(text_blocks)
