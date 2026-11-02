FROM nginx:alpine

ARG NGINX_CONFIG=nginx/local.conf

COPY ./src/ /usr/share/nginx/html/
COPY ${NGINX_CONFIG} /etc/nginx/conf.d/default.conf

EXPOSE 80