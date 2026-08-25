import { IsNotEmpty, IsString } from 'class-validator';

export class EntitlementCheckerDto {
    /**
     *
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: 'entitlementChecker';

    @IsString()
    @IsNotEmpty()
    public offeringId: string;

    @IsString()
    @IsNotEmpty()
    public businessID: string;
}
