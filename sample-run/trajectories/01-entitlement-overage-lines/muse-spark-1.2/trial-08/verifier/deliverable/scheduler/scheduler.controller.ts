import { Controller, Get, Post, Body, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerDto, SchedulerReadResponseDTO } from './dto/scheduler.dto.js';
import { ApiOkResponse } from '@nestjs/swagger';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { randomUUID } from 'crypto';

@Controller('scheduler')
export class SchedulerController {
    constructor(private readonly schedulerService: SchedulerService) {}

    /**
     * Create a customer or update a schedule
     */
    @ApiOkResponse({
        description: 'Response structure  for creating / updating a schedule',
        type: BasicResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    create(@Body() schedulerDto: SchedulerDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.schedulerService.create({ ...schedulerDto, businessID, subject: sub });
    }
    /**
     * Create a customer or update a schedule
     */
    @ApiOkResponse({
        description: 'Response structure  for creating / updating a schedule',
        type: BasicResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @Post('emit')
    emitOne(@Body() payload, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.schedulerService.emitOne({ schedulerId: randomUUID(), payload: { ...payload, businessID, sub } });
    }

    /**
     * Get all schedules assocaited with your account
     */
    @ApiOkResponse({
        description: 'Response structure for getting all schedules',
        type: SchedulerReadResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @Get()
    findAll(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.schedulerService.findAll({ businessID });
    }

    /**
     * Get a single Schedule based on ID
     */
    @ApiOkResponse({
        description: 'Response structure for getting a single schedules',
        type: SchedulerReadResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @Get(':schedulerID')
    findOne(@Param('schedulerID') schedulerID: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.schedulerService.findOne({ businessID, schedulerID });
    }

    /**
     * Remove a schdule, this will stop the schedule before the next run,
     * if a run recently happened or is happening it will not stop it from executing
     */
    @UseGuards(AuthGuard('jwt'))
    @Delete(':schedulerID')
    remove(
        @Param('schedulerID') schedulerID: string,
        @Query('isBillingQueue') isBillingQueue: string,
        @Req() request: Request,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.schedulerService.remove({ businessID, schedulerID, isBillingQueue: isBillingQueue !== undefined });
    }
}
