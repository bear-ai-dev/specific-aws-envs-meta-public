import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { FreeTrialEntity } from '../entities/freeTrial.entity.js';
import { FreeTrialStatus } from './FreeTrialStatus.js';

export class FreeTrialResponseDto extends BasicResponseDTO {
    public data: Array<{ expireTime?: number; freeTrialStatus: FreeTrialStatus }>;

    static fromEntity(freeTrialEntity: FreeTrialEntity): FreeTrialResponseDto {
        const { expireTime, freeTrialStatus } = freeTrialEntity;
        return { message: 'Free Trial Status', data: [{ expireTime, freeTrialStatus }] };
    }
}
