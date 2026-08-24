import { IntersectionType, OmitType } from '@nestjs/swagger';
import { CreateCustomerDto, CreateCustomerResponseDto } from '../../customer/dto/create-customer.dto';
import { CustomerAuthenticationTokenResponse } from '../../customer/dto/get-customer-auth.dto';

export class CreateCustomerOnboarding extends OmitType(CreateCustomerDto, ['taxExempt'] as const) {}

export class CreateCustomerOnboardingResponse extends IntersectionType(
    CreateCustomerResponseDto,
    CustomerAuthenticationTokenResponse,
) {}
