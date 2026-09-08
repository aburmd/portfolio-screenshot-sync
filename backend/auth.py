"""Cognito JWT verification helper.

Decodes the Cognito ID token from the Authorization header and returns claims.
No extra Cognito API call needed — uses the public JWKS endpoint.
JWKS keys are cached in-memory for the Lambda lifetime.
"""
import os
import urllib.request
import json as _json
from functools import lru_cache
from fastapi import Request, HTTPException
from jose import jwt, JWTError

REGION          = os.environ.get("AWS_REGION", "us-west-1")
USER_POOL_ID    = os.environ.get("COGNITO_USER_POOL_ID", "us-west-1_DRjc1Cz3h")
APP_CLIENT_ID   = os.environ.get("COGNITO_CLIENT_ID", "")
JWKS_URL        = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"


@lru_cache(maxsize=1)
def _get_jwks():
    with urllib.request.urlopen(JWKS_URL) as r:
        return _json.loads(r.read())


def decode_token(token: str) -> dict:
    """Decode and verify a Cognito ID token. Returns claims dict."""
    jwks = _get_jwks()
    try:
        claims = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={"verify_at_hash": False, "verify_aud": False},
        )
        return claims
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def get_claims(request: Request) -> dict:
    """Extract and decode JWT from Authorization header. Raises 401 if missing/invalid."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    return decode_token(auth[7:])


def require_admin(request: Request) -> dict:
    """Like get_claims but also asserts custom:role == admin."""
    claims = get_claims(request)
    if claims.get("custom:role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return claims
