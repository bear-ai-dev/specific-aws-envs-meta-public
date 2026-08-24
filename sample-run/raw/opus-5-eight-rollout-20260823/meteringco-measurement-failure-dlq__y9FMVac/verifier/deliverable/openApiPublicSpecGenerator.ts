import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { PublicAPIOfferingModule } from './offering/offering.module.js';
import { PublicAPICustomerModule } from './customer/customer.module.js';
import { MeasurementConfigModule } from './measurement-config/measurement-config.module.js';
import { PublicAPIDimensionsModule } from './dimensions/dimensions.module.js';
import { UsageModule } from './usage/usage.module.js';
import { PublicAPIInvoicesModule } from './invoice/invoices.module.js';
import { CreditModule } from './credit/credit.module.js';
import { WebhookModule } from './webhook/webhook.module.js';
import { PublicAPISettingModule } from './setting/settings.module.js';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    const config = new DocumentBuilder()
        .setTitle('MeteringCo API')
        // .setDescription('For user documentation of the platform, please visit https://docs.meteringco.example.')
        .setDescription(
            `
For developer documentation of the platform, please visit https://docs.meteringco.example.

## Authentication
MeteringCo API supports **bearer token** as the authentication method.
Steps to set up authentication:
1. Sign up with MeteringCo platform and get **client id** and **client secret**.
2. Make a POST request to the auth endpoint \`https://auth.meteringco.example/oauth/token\` with the following body:
\`\`\`json
{
        audience: 'https://example1234.execute-api.us-east-1.amazonaws.com',
        grant_type: 'client_credentials',
        client_id: <your client id>,
        client_secret: <your client secret>
}
\`\`\`
Additionally verify that the following headers are set by the client you are using: 
\`\`\`json
{
    "Content-Type": "application/json"
}
\`\`\`

3. Use the access token in the response to make requests to the MeteringCo API. Here is an example of the response:  
\`\`\`json   
{
            access_token: <your access token>,
            expires_in: 86400,
            token_type: 'Bearer'  
}
\`\`\`
4. To use MeteringCo API, add in the header of your request:
\`\`\`json
{
        Authorization: "Bearer <your access token>"
}
\`\`\`

## API Endpoints
MeteringCo API has the following endpoint:
- Production Environment API: \`https://api.prod.meteringco.example\`
        `,
        )
        .setVersion('v1.10')
        .addTag('Usage', 'Measure and collect usage data.')
        .addTag('Dimensions', 'Manage dimensions in MeteringCo.')
        .addTag('Offerings', 'Manage offerings in MeteringCo.')
        .addTag('Customers', 'Manage customers in MeteringCo.')
        .addTag('Invoices', 'Manage invoices in MeteringCo.')
        .addTag(
            'Measurements',
            'Manage measurements in MeteringCo. <br><br> See <a href="https://docs.meteringco.example/measure-usage-and-collect-data/measure-and-collect-usage-data-at-production-scale">Measure and Collect Usage Data at Production Scale</a> for more information.',
        )
        .addServer('https://api.prod.meteringco.example', 'Product Environment API')
        .addBearerAuth(
            {
                type: 'oauth2',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                in: 'Header',
                description: 'Use bearer token to authenticate `Bearer <your access token>`',
                flows: {
                    clientCredentials: {
                        tokenUrl: 'https://auth.meteringco.example/oauth/token',
                        scopes: {},
                    },
                },
            },
            'bearer',
        )
        .build();
    const document = SwaggerModule.createDocument(app, config, {
        include: [
            PublicAPIOfferingModule,
            PublicAPIDimensionsModule,
            MeasurementConfigModule,
            PublicAPICustomerModule,
            UsageModule,
            PublicAPIInvoicesModule,
            CreditModule,
            WebhookModule,
            PublicAPISettingModule,
        ],
    });
    writeFileSync('./docs/open-api-public-spec.json', JSON.stringify(document, null, 2));

    // For some reason the app doesn't want to close so we need to manually call app.close, I believe there may be some service which cannot initalize underneath (likely redis and bullmq)
    await app.close();
    console.log('finished!');
}
bootstrap();
