import {
    Controller,
    Get,
    Body,
    UseGuards,
    Put,
    Req,
    UseInterceptors,
    Post,
    UploadedFile,
    FileTypeValidator,
    MaxFileSizeValidator,
    ParseFilePipe,
} from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Express } from 'express';
import { ReadProfileResponse, ReadProfileResponseData, ReadSettingsResponse } from './dto/read-setting.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UserPermissions } from '../users/user.permissions.js';
import { FreeTrialDto } from './dto/freeTrial.dto.js';
import { FreeTrialResponseDto } from './dto/FreeTrialData.js';

@ApiBearerAuth('bearer')
@Controller('settings')
@ApiTags('Settings')
export class PublicSettingsController {
    constructor(readonly settingService: SettingsService) {}
    /**
     * Get Business Info.
     */
    @ApiOkResponse({
        status: 200,
        description: 'Get Business Profile',
        type: ReadProfileResponseData,
    })
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Get Business Profile Settings' })
    @Get('profile')
    getProfile(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;

        return this.settingService.getProfile({ businessID, subject: sub });
    }

    /**
     * Update Business Info. <br>
     * All fields are optional, only the fields sent are updated, all other settings are left as they are.
     */
    @ApiOkResponse({
        status: 200,
        description: 'Updated Business Profile',
        type: ReadProfileResponse,
    })
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Update Business Profile Settings' })
    @Put('profile')
    updateProfile(@Body() updateProfileDto: UpdateProfileDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;

        return this.settingService.updateProfile({ ...updateProfileDto, businessID, subject: sub });
    }

    /**
     * Upload Business Logo, file format supported: png,jpg,jpeg; max file size supported: 30Mb.
     */
    @ApiOkResponse({
        status: 201,
        description: 'A message describing the upload success',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Upload Invoice Image' })
    @Post('invoiceImage')
    @UseInterceptors(FileInterceptor('file'))
    @UseGuards(AuthGuard('jwt'))
    uploadFile(
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({ fileType: '.(png|jpg|jpeg)' }),
                    new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 30 }),
                ],
            }),
        )
        file: Express.Multer.File,
        @Req() request: Request,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.settingService.fileUpload({ file: file.buffer, businessID });
    }
}

@ApiBearerAuth('bearer')
@Controller('settings')
@ApiTags('Settings')
export class SettingsController extends PublicSettingsController {
    /**
     * Return all Settings for a business
     */
    @ApiOkResponse({
        status: 200,
        description: 'Returned platform settings',
        type: ReadSettingsResponse,
    })
    @ApiOperation({ operationId: 'Get Settings' })
    @UseGuards(AuthGuard('jwt'))
    @Get()
    findAll(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.settingService.findAll({ businessID });
    }

    /**
     * Update settings <br>
     * All fields are optional
     */
    @ApiOkResponse({
        status: 200,
        description: 'Updated platform settings',
        type: ReadSettingsResponse,
    })
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Update Settings' })
    @Put()
    update(@Body() updateSettingDto: UpdateSettingsDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;

        return this.settingService.update({ ...updateSettingDto, businessID, subject: sub });
    }

    @ApiOkResponse({
        status: 201,
        description: 'Reflection of the free trial information and a message',
        type: FreeTrialResponseDto,
    })
    @ApiOperation({ operationId: 'Create free-trial for business' })
    @Post('free-trial')
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    freeTrial(@Body() freeTrial: FreeTrialDto) {
        return this.settingService.manageFreeTrial({ ...freeTrial });
    }

    @ApiOkResponse({
        status: 201,
        description: 'Free Trial Information',
        type: FreeTrialResponseDto,
    })
    @ApiOperation({ operationId: 'Get Free Trial Information' })
    @Get('free-trial')
    @UseGuards(AuthGuard('jwt'))
    findFreeTrial(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.settingService.findFreeTrialInformation({ businessID });
    }
}
