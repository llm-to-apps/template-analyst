ARG AGENT_TOOLS_IMAGE=ghcr.io/llm-to-apps/agent-tools:sha-8b6fe99

FROM ${AGENT_TOOLS_IMAGE} AS agent-tools

FROM node:22-alpine AS runtime

RUN apk add --no-cache bash ca-certificates git openssh-client patch
COPY --from=agent-tools /usr/local/bin/agent-tools /usr/local/bin/agent-tools

WORKDIR /workspace

ENV PORT=80
ENV HOSTNAME=0.0.0.0
ENV AGENT_WORKDIR=/workspace
ENV AGENT_TOOLS_PORT=7070
ENV NODE_ENV=production
ENV APP_MODE=prod
ENV APP_RESTORE_COMMAND="npm ci"
ENV APP_STARTUP_COMMANDS="npm run bootstrap"
ENV APP_COMMAND="npm run start"
ENV APP_DEV_COMMAND="npm run dev:docker"
ENV APP_DEV_IDLE_TIMEOUT_SECONDS=60
ENV APP_BUILD_COMMAND="npm run build"
ENV APP_PROD_COMMAND="npm run start"
ENV GIT_PRESERVE_PATHS="node_modules:uploads:extensions"

COPY package.json package-lock.json ./
RUN npm ci

COPY extensions ./extensions
COPY scripts ./scripts
COPY tests ./tests
COPY AGENT.md README.md .gitignore ./

RUN npm run build

EXPOSE 80 7070

ENTRYPOINT ["agent-tools"]
