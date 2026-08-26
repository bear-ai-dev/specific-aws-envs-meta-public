import { OmitType } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { OrganizationEntity } from '../entities/organization.entity.js';

export class OrganizationResponseDataDto extends OmitType(OrganizationEntity, [
    'businessID',
    'subjects',
    'organizationStatus',
    'emails',
] as const) {}

export class OrganizationResponseDto extends BasicResponseDTO {
    data: OrganizationResponseDataDto[];

    public static fromEntity(organizationEntity: OrganizationEntity, message?: string): OrganizationResponseDto {
        const organizationResponseDto = new OrganizationResponseDto();
        const { orgId, organizationDisplayName } = organizationEntity;
        organizationResponseDto.data = [{ orgId, organizationDisplayName }];
        organizationResponseDto.message = message;
        return organizationResponseDto;
    }
}
