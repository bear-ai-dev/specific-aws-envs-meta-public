import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsHexColor,
    IsNotEmptyObject,
    IsNumberString,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested,
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class FeaturedOfferingPortalDto {
    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    text?: string;
    constructor(doc) {
        if (doc) {
            this.text = doc.text;
        }
    }
}

export function OfferingIdCanBeEmptyIfExternalLinkExists(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'OfferingIdCanBeEmptyIfExternalLinkExists',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: {
                async validate(offeringId: any, args: ValidationArguments) {
                    if (offeringId === null || offeringId === undefined || offeringId === '') {
                        try {
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            // @ts-ignore
                            if (args.object.externalLink) {
                                return true;
                            } else {
                                return false;
                            }
                        } catch (e) {
                            return false;
                        }
                    } else {
                        return true;
                    }
                },
            },
        });
    };
}

export class PricingTableOfferingPortalDto {
    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    ctaBorder?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    ctaBackground?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    ctaText?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    featureListColor?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    pricePlanBackground?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    highlightedPrice?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    featureListIcon?: string;

    @IsBoolean()
    @IsOptional()
    @ApiProperty({ type: Boolean, required: false })
    showLogo?: boolean;

    constructor(doc: PricingTableOfferingPortalDto) {
        if (doc) {
            this.ctaBorder = doc.ctaBorder;
            this.ctaBackground = doc.ctaBackground;
            this.ctaText = doc.ctaText;
            this.featureListColor = doc.featureListColor;
            this.pricePlanBackground = doc.pricePlanBackground;
        }
    }
}

export class AppearanceOfferingPortalDto {
    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    border?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    background?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    accent?: string;

    @IsNumberString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    radius?: string;

    @IsString()
    @IsHexColor()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    meteringcoBranding?: string;

    @IsOptional()
    @Type(() => PricingTableOfferingPortalDto)
    @ValidateNested()
    @ApiProperty({ type: PricingTableOfferingPortalDto })
    pricingTable?: PricingTableOfferingPortalDto;

    constructor(doc: AppearanceOfferingPortalDto) {
        if (doc) {
            this.border = doc.border;
            this.background = doc.background;
            this.radius = doc.radius;
            this.accent = doc.accent;
            this.meteringcoBranding = doc.meteringcoBranding;
            this.pricingTable = new PricingTableOfferingPortalDto(doc.pricingTable);
        }
    }
}
export class CTAOfferingPortalDto {
    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    text: string;

    @OfferingIdCanBeEmptyIfExternalLinkExists('offeringId', {
        message: 'offeringId and externalLink cannot be empty at the same time',
        always: true,
    })
    @ApiProperty({ type: String, required: false })
    offeringId?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    externalLink?: string;

    constructor(doc) {
        if (doc) {
            this.text = doc.text;
            this.offeringId = doc.offeringId;
            this.externalLink = doc.externalLink;
        }
    }
}
export class PortalOfferingPageDto {
    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    title?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    subtitle?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    price?: string;

    @IsOptional()
    @Type(() => FeaturedOfferingPortalDto)
    @ValidateNested()
    @ApiProperty({ type: FeaturedOfferingPortalDto, required: false })
    featured?: FeaturedOfferingPortalDto;

    @IsObject()
    @IsNotEmptyObject()
    @Type(() => CTAOfferingPortalDto)
    @ValidateNested()
    @ApiProperty({ type: CTAOfferingPortalDto, required: true })
    cta: CTAOfferingPortalDto;

    @IsString()
    @IsOptional()
    @ApiProperty({ type: String, required: false })
    description?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ApiProperty({ isArray: true, type: String, required: true })
    features: string[];

    constructor(doc) {
        if (doc) {
            this.title = doc.title;
            this.subtitle = doc.subtitle;
            this.price = doc.price;
            this.featured = new FeaturedOfferingPortalDto(doc.featured);
            this.cta = new CTAOfferingPortalDto(doc.cta);
            this.description = doc.description;
            this.features = doc.features;
        }
    }
}
