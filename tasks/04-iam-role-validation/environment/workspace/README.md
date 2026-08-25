# MeteringCo Backend

This repository serves to hold the backend infrastructure for MeteringCo. Specifically it contains the code for the Private and Public API

### Current Status

Don't break this.
[![CI](https://github.com/example-metering-org/example-billing-service/actions/workflows/main.yml/badge.svg)](https://github.com/example-metering-org/example-billing-service/actions/workflows/main.yml)

# Folder Structure

| .prettierrc.json - prettier formatting file  
| .eslintrc.cjs - linter configuration only comment out linting rules if there a good reason  
| .gitignore - ignored files for source control  
| src - source for the api application  


# Getting started with Local Development

# Environment

-   Latest version of [NVM](https://github.com/nvm-sh/nvm)
-   Latest version of NodeJS 18.x `nvm install 18`
-   Latest version of [AWS CLI](https://aws.amazon.com/cli/)
-   Latest version of [Docker Desktop](https://www.docker.com/products/docker-desktop/)
-   Assigned AWS accounts and IAM credentials
-   [Redoc](https://github.com/Redocly/redoc#redoc-cli) for automatically generating html from the open api specification, see install [here](https://stackoverflow.com/questions/25800493/converting-swagger-specification-json-to-html-documentation)
-   Latest version of [Kind](https://kind.sigs.k8s.io/) for the local integration test enviornment, see install [here](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
-   Latest version of [Helm](https://helm.sh/) see the install guild [here](https://helm.sh/docs/intro/install/)

For the remainng item of this list, you should figure out yourself if you don't already know.

-   [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
-   A good terminal (such as [iTerm2](https://iterm2.com/index.html) + [ohmyzsh](https://ohmyz.sh/))
-   A good IDE (such as [VSCode](https://code.visualstudio.com/), or [WebStorm](https://www.jetbrains.com/webstorm/))
-   Helpful for command line navigation [z](https://facilecode.com/how-to-setup-z-jump-around/)

# Setup

1. Configure AWS CLI. `aws configure`. See sample config below. Use _us-east-1_ as default region and _json_ as default output format.

```bash
aws configure
AWS Access Key ID [None]: XXXXXXXXXXX
AWS Secret Access Key [None]: XXXXXXXXXXXXXXXXXXXXXX
Default region name [None]: us-east-1
Default output format [None]: json
```

2. Clone the repository.
3. Run: `npm run setup:influx` Visit _http://localhost:8086_ to make sure InfluxDB is running locally.
4. Going through the setup guide of local InfuxDB. Configure the `local-usage-data` bucket, the `local-config` bucket and the `meteringco` org. **Case sensitive**.
5. [Get an API Token from the Influx instance](https://docs.influxdata.com/influxdb/cloud/security/tokens/create-token/)
6. Create the following file at the root directory of the project named `.env`, where the `INFLUX_URL`, `INFLUX_TOKEN` and `INFLUX_ORG` values are stored

Your token will be different than the one below.

```txt
AUTH0_ISSUER_URL=https://auth.meteringco.example/
AUTH0_AUDIENCE=https://example1234.execute-api.us-east-1.amazonaws.com
INFLUX_TOKEN=<fillmein>
INFLUX_ORG=meteringco
INFLUX_URL=http://localhost:8086
GENERIC_EXPRESS=true
STAGE=local
STRIPE_TOKEN=<fillmein>
REDIS_URL=localhost
REDIS_PORT=6379
DB_MEASUREMENT_BUCKET_NAME=meteringco-usage-record-dump-bucket-local
DB_MEASUREMENT_DLQ_BUCKET_NAME=meteringco-usage-record-dlq-bucket-local
SESSION_SECRET=E9hnz1oqeGUeYYWb3Q
METERINGCO_URL=http://localhost:3000
METERINGCO_DASHBOARD_CLIENT_SECRET=<fillmein>
METERINGCO_DASHBOARD_CLIENT_ID=<fillmein>
METERINGCO_AWS_ACCOUNT=123456789012
TAX_JAR_URL=https://api.sandbox.taxjar.com/
PROD_TAX_JAR_URL=https://api.taxjar.com
JWT_SECRET=foobarfoobaroo
OPEN_EXCHANGE_RATE_API_KEY=<fillmein>
STRIPE_PROD_CLIENT_ID=<fillmein>
STRIPE_CLIENT_ID=<fillmein>
PROD_STRIPE_TOKEN=<fillmein>
```

8. Navigate to the project folder you want to work on. Install dependencies. `npm ci`
9. Run `npm run setup:redis`
10. Run tests to ensure all tests passed. `npm run test`

### Local Integration environment

The local integration environment has a few parts. Locally deployed will be a kind based kubernetes cluster, and then the meteringco-backend docker image will be deployed into the kind cluster as a pod. The tests then run against that enviornment. This specifically is testing the `transformer` and `scheduler` functionality.

The `pre-commit` npm script handles setup and teardown of the enviornment, all that is required is the installation of the required dependencies to get the env working.

### Developing

When working on the project please note the following.

-   Create a Branch named from the associated clickup task id, commit directly to the branch.
    -   Prior to merging verify that work in good to go with another developer, either through pair programming it with them, or by requesting a sync review of the diff.
    -   We are following Trunk based development: https://trunkbaseddevelopment.com/
-   Make sure to run linting, building, and testing before committing
    -   A dependency, `husky` should setup the pre-commit hook to run which is triggered when you run `git commit -m "MY cool message"` and handles this automagically for you.
-   To run the api locally utilize `npm run build && npm run start:generic` with the appropriate values in via the `.env` file.

An example of a local `.env` file is the following

```txt
AUTH0_ISSUER_URL=https://auth.meteringco.example/
AUTH0_AUDIENCE=https://example1234.execute-api.us-east-1.amazonaws.com
INFLUX_TOKEN=<fillmein>
INFLUX_ORG=meteringco
INFLUX_URL=http://localhost:8086
GENERIC_EXPRESS=true
STAGE=local
STRIPE_TOKEN=<fillmein>
REDIS_URL=localhost
REDIS_PORT=6379
DB_MEASUREMENT_BUCKET_NAME=meteringco-usage-record-dump-bucket-local
DB_MEASUREMENT_DLQ_BUCKET_NAME=meteringco-usage-record-dlq-bucket-local
SESSION_SECRET=E9hnz1oqeGUeYYWb3Q
METERINGCO_URL=http://localhost:3000
METERINGCO_DASHBOARD_CLIENT_SECRET=<fillmein>
METERINGCO_DASHBOARD_CLIENT_ID=<fillmein>
METERINGCO_AWS_ACCOUNT=123456789012
TAX_JAR_URL=https://api.sandbox.taxjar.com/
PROD_TAX_JAR_URL=https://api.taxjar.com
JWT_SECRET=foobarfoobaroo
OPEN_EXCHANGE_RATE_API_KEY=<fillmein>
STRIPE_PROD_CLIENT_ID=<fillmein>
STRIPE_CLIENT_ID=<fillmein>
PROD_STRIPE_TOKEN=<fillmein>
```

-   Important! We run integration tests to confirm that nothing has broken. These can be ran with the `npm run prepare:integration && npm run test:local:integration`. Additionally in CI you can point the integration test suite at your branch here: https://github.com/example-metering-org/example-billing-service/actions/workflows/integrationTest.yml. This will _not_ deploy your changes. It just runs your branch's test suite against qa.
-   Please note that local integration tests assume that the API is running against localhost:3000, which means you need to have the API running already via: `npm run start:generic`
-   You will need to create a `token_cache.json` file in the `integration` directory, the contents of the file are the following:

```JSON
{}
```

Yes its just an empty json file. This file gets used by the integration environment to cache secret credentials which are not committed, but it isn't sophisticated enough to create the file if it doesn't exist.

Additionally you'll need a `secret.json` file in the `integration` directory (ping @Twosdai for creds). For the token values below. The `influx_token` should be from your local influxdb at `http://localhost:8086`

```JSON
{

    "client_id": "fillmeIn",
    "client_secret": "fillmeIn",
    "admin_client_id": "fillmeIn",
    "admin_client_secret": "fillmeIn",
    "test_client_id": "fillmeIn",
    "test_client_secret": "fillmeIn",
    "influx_token": "fillmeIn",
    "test_1_aws_account_id": "fillmeIn",
    "test_1_aws_access_key_id": "fillmeIn",
    "test_1_aws_secret_access_key": "fillmeIn",
    "test_2_aws_account_id": "fillmeIn",
    "test_2_aws_access_key_id": "fillmeIn",
    "test_2_aws_secret_access_key": "fillmeIn"
}

```

#### Additional Developing Hints

To quickly turn off redis and influx run `npm run cleanup:integration`

### Documentation

Currently we have a system to automatically create a valid OpenAPI document based on the decorators on the `DTO` files under each `./src/${api_resource_directory}`. Specifically we use a script defined in the `./src/openApiSpecGenerator` file to create the open api specifications. This script can be called via running `npm run build && npm run generate:specification`.
