FROM nginx:alpine

# Replace nginx default site config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy your static site
COPY index.html /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/
COPY screenshots/ /usr/share/nginx/html/screenshots/

# Healthcheck hits /healthz served by nginx.conf above
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
