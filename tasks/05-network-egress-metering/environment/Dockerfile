FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates curl git jq lsof make procps python3 ripgrep sudo tzdata \
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

# The emulated control plane is readable but not writable: it stands in for AWS,
# it is not part of the deliverable.
COPY --chown=root:root mockaws/ /opt/mockaws/mockaws/
RUN chmod -R a+rX /opt/mockaws && \
    find /opt/mockaws -name '__pycache__' -prune -exec rm -rf {} +

# Verifier-only material: the held-out estate, the runs it is exercised over,
# and the trusted driver. The agent account sees an opaque parent directory and
# nothing inside it. Nothing under here is world readable in any layer, and the
# generator that produced the estate never enters the image at all.
RUN install -d -m 0700 -o root -g root /var/lib/task-data /var/lib/task-data/verifier
COPY --chown=root:root --chmod=600 verifier-data/ /var/lib/task-data/verifier/

# The sandbox estate the emulator serves to the box itself. Readable, tame, and
# unrelated to what the verifier serves.
RUN install -d -m 0755 -o root -g root /opt/billing-sandbox
COPY --chown=root:root --chmod=0444 sandbox/ /opt/billing-sandbox/

RUN install -d -o agent -g agent /app
WORKDIR /app
COPY --chown=agent:agent workspace/ /app/

# The native snappy binding in the dependency tree has no prebuilt artifact for
# this image and is not on any path the service uses, so install skips scripts.
USER agent
RUN npm install --no-audit --no-fund --ignore-scripts
USER root

# Root-only reference copy of the starting sources. The verifier hashes it to
# tell the submission's own files from the ones the box was handed.
RUN install -d -m 0700 -o root -g root /var/lib/task-data/pristine_app && \
    tar -C /app --exclude=./node_modules -cf - . | tar -C /var/lib/task-data/pristine_app -xf - && \
    chown -R root:root /var/lib/task-data/pristine_app && \
    chmod -R go-rwx /var/lib/task-data/pristine_app

COPY --chown=root:root task-init.sh /usr/local/bin/task-init.sh
RUN chmod 0755 /usr/local/bin/task-init.sh

# AWS_REGION is not redundant with AWS_DEFAULT_REGION: the SDK pinned in this
# tree reads only the former, and callers that build a client without an
# explicit region have no other source for it inside the image.
ENV AWS_ENDPOINT_URL=http://127.0.0.1:4566 \
    AWS_ACCESS_KEY_ID=LOCALMETERINGKEY01 \
    AWS_SECRET_ACCESS_KEY=billing-secret \
    AWS_REGION=us-east-1 \
    AWS_DEFAULT_REGION=us-east-1 \
    NODE_OPTIONS=--max-old-space-size=2048 \
    PYTHONDONTWRITEBYTECODE=1

ENTRYPOINT ["/usr/local/bin/task-init.sh"]
CMD ["--wait"]
