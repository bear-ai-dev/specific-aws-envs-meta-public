import { Controller, Get } from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@Controller('health')
@ApiTags('HealthCheck')
export class AppController {
    constructor(private readonly appService: AppService) {}

    @ApiOperation({ operationId: 'Health Check' })
    @Get()
    getHealthCheck() {
        return this.appService.getHealthCheck();
    }
}
