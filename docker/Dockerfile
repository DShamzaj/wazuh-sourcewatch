# Wazuh dashboard image with SourceWatch pre-installed (for wazuh-docker deployments).
# Place the release zip next to this file, then:
#   docker build --build-arg WAZUH_VERSION=4.14.9 -t wazuh-dashboard-sourcewatch:4.14.9 .
# and use this image for the wazuh.dashboard service in docker-compose.yml.
ARG WAZUH_VERSION=4.14.9
FROM wazuh/wazuh-dashboard:${WAZUH_VERSION}
COPY sourcewatch-*.zip /tmp/sourcewatch.zip
RUN /usr/share/wazuh-dashboard/bin/opensearch-dashboards-plugin install file:///tmp/sourcewatch.zip
