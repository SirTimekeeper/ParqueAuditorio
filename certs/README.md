# Certificados HTTPS

Coloque nesta pasta os ficheiros do certificado e da chave para HTTPS (por exemplo: `local.crt` e `local.key`).

Exemplo para arrancar em HTTPS:

```bash
HTTPS_KEY_PATH=certs/local.key HTTPS_CERT_PATH=certs/local.crt npm run dev
```
