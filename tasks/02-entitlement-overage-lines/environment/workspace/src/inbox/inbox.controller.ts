import { Controller, Get, Post, Body, Patch, Param, Delete, Req, Put, UseGuards } from '@nestjs/common';
import { InboxService } from './inbox.service.js';
import { CreateInboxDto } from './dto/create-inbox.dto.js';
import { UpdateInboxDto } from './dto/update-inbox.dto.js';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Inbox')
@Controller('inbox')
export class InboxController {
    constructor(private readonly inboxService: InboxService) {}

    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Create a message in the inbox' })
    @Post()
    create(@Body() createInboxDto: CreateInboxDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.inboxService.create({ ...createInboxDto, businessID });
    }
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Get all messages' })
    @Get()
    findAll(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.inboxService.findAll({ businessID });
    }
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Get a specific message' })
    @Get(':inboxId')
    findOne(@Param('inboxId') inboxId: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.inboxService.findOne({ inboxId, businessID });
    }
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Archive a message' })
    @Put(':inboxId')
    update(@Param('inboxId') inboxId: string, @Body() updateInboxDto: UpdateInboxDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.inboxService.update({ ...updateInboxDto, businessID, inboxId });
    }
}
