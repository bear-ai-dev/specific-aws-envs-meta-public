import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { AzureService } from './azure.service.js';
import { CreateAzureDto } from './dto/create-azure.dto.js';
import { UpdateAzureDto } from './dto/update-azure.dto.js';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

@Controller('azure')
@ApiBearerAuth('bearer')
export class AzureController {
    constructor(private readonly azureService: AzureService) {}

    @Get('azure/:dimensionId')
    @UseGuards(AuthGuard('jwt'))
    async getAll(@Param('dimensionId') dimensionId: string, @Req() request: Request) {
        let res = [];
        res = res.concat(
            await this.azureService.disk(
                {
                    data: {
                        rate: null,
                        scheduleParameters: null,
                        businessID: 'myCoolCorp',
                        subject: null,
                    },
                },
                dimensionId,
            ),
        );
        res = res.concat(
            await this.azureService.vm(
                {
                    data: {
                        rate: null,
                        scheduleParameters: null,
                        businessID: 'myCoolCorp',
                        subject: null,
                    },
                },
                dimensionId,
            ),
        );
        return res;
    }

    @Get('disk/:dimensionId')
    @UseGuards(AuthGuard('jwt'))
    disk(@Param('dimensionId') dimensionId: string, @Req() request: Request) {
        return this.azureService.disk(
            {
                data: {
                    rate: null,
                    scheduleParameters: null,
                    businessID: 'myCoolCorp',
                    subject: null,
                },
            },
            dimensionId,
        );
    }

    @Get('vm/:dimensionId')
    @UseGuards(AuthGuard('jwt'))
    vm(@Param('dimensionId') dimensionId: string, @Req() request: Request) {
        return this.azureService.vm(
            {
                data: {
                    rate: null,
                    scheduleParameters: null,
                    businessID: 'myCoolCorp',
                    subject: null,
                },
            },
            dimensionId,
        );
    }
}
