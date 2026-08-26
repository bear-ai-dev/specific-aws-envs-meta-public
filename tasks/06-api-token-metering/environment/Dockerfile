FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates curl git jq make procps python3 ripgrep sudo tzdata \
        patch tmux asciinema && \
    rm -rf /var/lib/apt/lists/*

# Lets anything in the image execute the project's TypeScript without a build
# step, which is how the service is exercised locally.
RUN npm install -g --no-audit --no-fund tsx@4.19.2

ENV TZ=Etc/UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN useradd --create-home --shell /bin/bash agent

# Terminal hardening. Agents deliver large files as a single pasted heredoc,
# and a pty wedged partway through that paste costs the whole trial.
COPY --chown=root:root hardening/shell-hardening.sh /etc/profile.d/10-shell-hardening.sh
COPY --chown=root:root hardening/tmux.conf /etc/tmux.conf
RUN chmod 0644 /etc/profile.d/10-shell-hardening.sh /etc/tmux.conf && \
    printf '\n. /etc/profile.d/10-shell-hardening.sh\n' >> /etc/bash.bashrc

# The emulated control plane is readable but not writable: it stands in for the
# managed AWS and time-series services, it is not part of the deliverable.
COPY --chown=root:root mockaws/ /opt/mockaws/mockaws/
RUN chmod -R a+rX /opt/mockaws && \
    find /opt/mockaws -name '__pycache__' -prune -exec rm -rf {} +

# Verifier-only material: the held-out account, the traffic it is exercised
# with, and the trusted driver. The agent account sees an opaque parent directory
# and nothing inside it. Nothing under here is world readable in any layer, and
# the generator that produced the worlds never enters the image at all.
RUN install -d -m 0700 -o root -g root /var/lib/task-data /var/lib/task-data/verifier
COPY --chown=root:root --chmod=600 verifier-data/ /var/lib/task-data/verifier/

# The world the store serves to the box itself: a recorded stretch of the
# platform metering its own API traffic. Readable, and a different account from
# anything the verifier serves.
RUN install -d -m 0755 -o root -g root /opt/metering-sandbox
COPY --chown=root:root --chmod=0444 sandbox/ /opt/metering-sandbox/

RUN install -d -o agent -g agent /app
WORKDIR /app
COPY --chown=agent:agent workspace/ /app/

# The native snappy binding in the dependency tree has no prebuilt artifact for
# this image and is not on any path the service uses, so install skips scripts.
USER agent
RUN npm install --no-audit --no-fund --ignore-scripts
USER root

# Root-only reference copy of the starting sources, so a finished run can be
# diffed against what the box began with. Nothing reads it during scoring.
RUN install -d -m 0700 -o root -g root /var/lib/task-data/pristine_app && \
    tar -C /app --exclude=./node_modules -cf - . | tar -C /var/lib/task-data/pristine_app -xf - && \
    chown -R root:root /var/lib/task-data/pristine_app && \
    chmod -R go-rwx /var/lib/task-data/pristine_app

COPY --chown=root:root task-init.sh /usr/local/bin/task-init.sh
RUN chmod 0755 /usr/local/bin/task-init.sh

# AWS_REGION is not redundant with AWS_DEFAULT_REGION: the SDK pinned in this
# tree reads only the former, and callers that build a client without an
# explicit region have no other source for it inside the image.
#
# INFLUX_URL, INFLUX_ORG and INFLUX_TOKEN are ordinary service configuration;
# the repository README lists the same names in its example .env.
# METERINGCO_DOGFOOD_INFLUX_SECRET is the credential the platform reads its own
# customer records with, and the repository README lists it too.
ENV AWS_ENDPOINT_URL=http://127.0.0.1:4566 \
    AWS_ACCESS_KEY_ID=AKIAMETERINGCOMETERING1 \
    AWS_SECRET_ACCESS_KEY=metering-secret \
    AWS_REGION=us-east-1 \
    AWS_DEFAULT_REGION=us-east-1 \
    INFLUX_URL=http://127.0.0.1:4566 \
    INFLUX_ORG=meteringco \
    INFLUX_TOKEN=northwind-sandbox-token \
    METERINGCO_DOGFOOD_INFLUX_SECRET=northwind-sandbox-token \
    STAGE=dev \
    METERINGCO_AWS_ACCOUNT=123456789012 \
    NODE_OPTIONS=--max-old-space-size=2048 \
    PYTHONDONTWRITEBYTECODE=1

ENTRYPOINT ["/usr/local/bin/task-init.sh"]
CMD ["--wait"]
