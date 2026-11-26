FROM nginx:1.27-alpine

# Aplicação (só o conteúdo de src/; a configuração local .env/env.json não entra)
COPY ./src/ /usr/share/nginx/html/

# Configuração do nginx com proxy para a API (variáveis substituídas no arranque)
COPY ./docker/default.conf.template /etc/nginx/templates/default.conf.template

# Gera /env.json no arranque a partir das variáveis de ambiente
COPY ./docker/40-env-json.sh /docker-entrypoint.d/40-env-json.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-env-json.sh \
    && chmod +x /docker-entrypoint.d/40-env-json.sh

EXPOSE 80
