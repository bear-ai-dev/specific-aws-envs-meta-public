import './tracer.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { TimingInterceptor } from './interceptors/timing.interceptor.js';
import { BusinessIDInterceptor } from './interceptors/businessID.interceptor.js';
import { EnvironmentService, UsersService } from './users/users.service.js';
import { FiveHundreadInternalErrorInterceptor } from './interceptors/500InternalResponseHandler.js';
import { useContainer } from 'class-validator';
import * as session from 'express-session';
import { InfluxService } from './influx/influx.service.js';

async function bootstrap() {
    console.log(`Starting a Generic Express Application for STAGE: ${process.env.STAGE}`);
    console.log(`process.env.INFLUX_URL: ${process.env.INFLUX_URL}`);
    console.log(`process.env.INFLUX_ORG: ${process.env.INFLUX_ORG}`);
    console.log(`process.env.REDIS_URL: ${process.env.REDIS_URL}`);
    console.log(`process.env.REDIS_PORT: ${process.env.REDIS_PORT}`);
    console.log(`process.env.AUTH0_ISSUER_URL: ${process.env.AUTH0_ISSUER_URL}`);
    const app = await NestFactory.create(AppModule);
    const influxService = new InfluxService();
    app.useGlobalInterceptors(
        new TimingInterceptor(),
        new BusinessIDInterceptor(
            new UsersService(influxService, new EnvironmentService(influxService)),
            new EnvironmentService(influxService),
        ),
        new FiveHundreadInternalErrorInterceptor(),
    );
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.use(
        session.default({
            secret: process.env.SESSION_SECRET,
        }),
    );

    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    await app.init();
    await app.listen(3000);
}

bootstrap();
