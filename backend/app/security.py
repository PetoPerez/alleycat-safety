import hashlib, secrets
def new_token(): return secrets.token_urlsafe(32)
def token_hash(token: str): return hashlib.sha256(token.encode()).hexdigest()
