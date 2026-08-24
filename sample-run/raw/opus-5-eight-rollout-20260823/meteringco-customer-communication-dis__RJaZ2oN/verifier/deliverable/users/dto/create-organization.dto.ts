import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateOrganizationDto {
    /**
     * The business enitity which the subject is tied to, multiple subjects can have the same businessID
     * @example myCoolCorp
     */
    @IsString()
    @IsOptional()
    businessID?: string;

    /**
     * The organization display name which should be used
     * @example myCoolCorp
     */
    @IsString()
    @IsNotEmpty()
    organizationDisplayName: string;

    /**
     * The subject associated with the jwt token on the authentication request
     * with Auth0 this is returned in the payload after the authentication process occurs
     */
    // TODO: Write a custom validator to check if the subject is already in an organization if it is, throw an error
    @IsString()
    @IsOptional()
    subjects?: string[];
}
