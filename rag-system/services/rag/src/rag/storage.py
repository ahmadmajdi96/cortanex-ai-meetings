from __future__ import annotations

from functools import lru_cache

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from rag.config import get_settings


@lru_cache
def s3_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def ensure_bucket() -> None:
    settings = get_settings()
    client = s3_client()
    try:
        client.head_bucket(Bucket=settings.minio_bucket)
    except ClientError:
        client.create_bucket(Bucket=settings.minio_bucket)


def put_object(key: str, body: bytes, content_type: str | None) -> None:
    settings = get_settings()
    ensure_bucket()
    s3_client().put_object(
        Bucket=settings.minio_bucket,
        Key=key,
        Body=body,
        ContentType=content_type or "application/octet-stream",
    )


def get_object(key: str) -> bytes:
    settings = get_settings()
    response = s3_client().get_object(Bucket=settings.minio_bucket, Key=key)
    return response["Body"].read()


def delete_object(key: str) -> None:
    settings = get_settings()
    try:
        s3_client().delete_object(Bucket=settings.minio_bucket, Key=key)
    except ClientError:
        pass
