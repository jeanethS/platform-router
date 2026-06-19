# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a Vulnerability

Report vulnerabilities to the maintainers via GitHub Issues or email.

## Security Measures

- **Transport**: Kafka TLS + SASL-SCRAM, HTTP mTLS (optional)
- **Dependencies**: `npm audit` runs in CI on every PR; Dependabot alerts enabled
- **Secrets**: No secrets in code; all config via env vars or ConfigMap
- **Data**: No PII persisted; all data is transient in-memory
- **Container**: Non-root user, multi-stage build, minimal Alpine base
- **Network**: No external exposure; internal K8s Service only
