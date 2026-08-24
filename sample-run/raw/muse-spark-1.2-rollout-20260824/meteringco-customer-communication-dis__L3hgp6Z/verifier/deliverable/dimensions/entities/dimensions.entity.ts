import { Point } from '@influxdata/influxdb-client';
import { Logger } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { InfluxService } from '../../influx/influx.service.js';

import {
    countBasedUnits,
    dataBasedUnits,
    overageAllowedEnum,
    roundingEnum,
    timeBasedUnits,
    infrastructureType,
    SampleType,
    aggregationInterval,
    aggregationMethod,
    PaymentSchedule,
} from '../dto/create-dimension.dto.js';
import { DimensionTierDto } from '../dto/dimensionTier.dto.js';
import { DimensionTiersGroupByMetadataDto } from '../dto/dimensionTiersGroupByMetadataDto.dto.js';

export enum dimensionUnit {
    Minute = 'Minutes',
    Hour = 'Hours',
    Gb = 'Gbs',
    Mb = 'Mbs',
    Count = 'Count',
}

export enum numericalType {
    float = 'float',
    int = 'int',
}

class PriceSegments {
    /**
     * A unit price to be associated in the tier
     * For instance a lower tier may have 0.05$ per Gb where as a higher tier may be 0.03$ per Gb
     *
     */
    public price?: string;
    /**
     * The lower limit of this tier in terms of usage
     *
     */
    public lowerLimit?: string;
    /**
     * The upper limit for this tier in terms of usage
     *
     */
    public upperLimit?: string;
}
/**
 * @author Developer One <developer.one@meteringco.example>
 *
 * @Class
 * The Catagorical subclass contains information for a catagorical element inside a dimension
 * It is not completed nor used at the moment
 *
 * @TODO  complete this class
 * */
export class Categorical {
    values?: {
        SLA?: string;
    };
    public static transformer(catagorical: Categorical, point: Point) {
        return point;
    }

    public static dbModelToEntity(row) {
        return {};
    }
}

export enum aggregationType {
    aggregation = 'aggregation',
}

/**
 * @author Developer One <developer.one@meteringco.example>
 *
 * @Class
 * The Numerical class is treated as a supporting structure to the dimension entity.
 * Specifically it contains the information needed to create a numerical based dimension.
 * As opposed to a catagorical dimension
 * */
export class Numerical {
    /**
     * The numericalType is used when aggregating and calculating data
     * For percision purposes when calculating the data its important to know ahead of time if the type is an interger or a float
     * @example "float"
     * @example "int"
     */
    public numericalType: numericalType;

    public dimensionUnit: timeBasedUnits | countBasedUnits | dataBasedUnits;

    public dimensionUnitType: 'count' | 'time' | 'data';

    /**
     * How often usage should be aggregated to, this is a window where usage will be aggregated up till.
     * For example if MeteringCo measures ever 10 minutes for uptime, 6 measurements would be taken, if aggregation is set to hourly, the usage will be totaled up and set for the hour.
     * @example Hour
     * @example Day
     * @example Month
     */
    public aggregationInterval: aggregationInterval;

    /**
     * The Aggregation Method associated with a dimension, typically will be total, however other options are supported
     * @example "sum"
     *
     */
    public aggregationMethod: aggregationMethod;

    /**
     * The Price Tier object is optional,
     * it provides additional information about any tier limits which the dimension should be aware of
     *
     */
    public priceSegments?: PriceSegments[];

    /**
     * The tiers array is optional,
     * it provides additional information about any tier limits which the dimension should be aware of
     *
     */
    public tiers?: DimensionTierDto[];

    /**
     * The tiersGroupByMetadata array is optional,
     * it provides grouping and tiers for grouping based on the metadata associated with usage for the dimension.
     */
    public tiersGroupByMetadata?: DimensionTiersGroupByMetadataDto[];
    /**
     *
     * The sample type used for the data. Counter is a monotonically increasing value. Gauge is a value that can go up or down.
     * @example "counter"
     * @example "gauge"
     */
    public sampleType: SampleType;

    public usageIncrement: number;

    public rounding: roundingEnum;

    public usageEntitlement?: number | 'inf';

    public overageAllowed?: overageAllowedEnum;

    constructor(numericalEntityInfo: Numerical) {
        if (numericalEntityInfo) {
            const {
                numericalType,
                dimensionUnit,
                aggregationInterval,
                aggregationMethod,
                priceSegments,
                sampleType,
                usageIncrement,
                rounding,
                usageEntitlement,
                overageAllowed,
                dimensionUnitType,
                tiers: tier,
                tiersGroupByMetadata,
            } = numericalEntityInfo;
            this.numericalType = numericalType;
            this.dimensionUnit = dimensionUnit;
            this.sampleType = sampleType;
            this.aggregationInterval = aggregationInterval;
            this.aggregationMethod = aggregationMethod;
            this.priceSegments = priceSegments;
            this.usageIncrement = usageIncrement;
            this.rounding = rounding;
            this.usageEntitlement = usageEntitlement;
            this.overageAllowed = overageAllowed ? overageAllowed : undefined;
            this.dimensionUnitType = dimensionUnitType;
            this.tiers = tier;
            this.tiersGroupByMetadata = tiersGroupByMetadata;
        }
    }

    public static transformer = (
        {
            numericalType,
            dimensionUnit,
            aggregationInterval,
            aggregationMethod,
            priceSegments,
            sampleType,
            usageIncrement,
            rounding,
            usageEntitlement,
            tiersGroupByMetadata,
            overageAllowed,
            dimensionUnitType,
            tiers,
        }: Numerical,
        point: Point,
    ): Point => {
        point.tag('numericalType', numericalType);
        point.tag('dimensionUnit', dimensionUnit);
        point.tag('aggregationInterval', aggregationInterval);
        point.tag('aggregationMethod', aggregationMethod);
        point.tag('sampleType', sampleType);
        point.tag('priceSegments', JSON.stringify(priceSegments));
        if (usageIncrement !== undefined) {
            point.tag('usageIncrement', usageIncrement.toString());
        }

        point.tag('rounding', rounding);
        if (usageEntitlement !== undefined && usageEntitlement !== null) {
            point.tag('usageEntitlement', usageEntitlement.toString());
        }

        if (overageAllowed !== undefined && overageAllowed !== null) {
            point.tag('overageAllowed', overageAllowed);
        }
        if (tiers) {
            point.tag('tiers', JSON.stringify(tiers));
        }
        if (tiersGroupByMetadata) {
            point.tag('tiersGroupByMetadata', JSON.stringify(tiersGroupByMetadata));
        }

        point.tag('dimensionUnitType', dimensionUnitType);
        return point;
    };
    public static dbModelToEntity = (row: any): Numerical => {
        const {
            numericalType,
            dimensionUnit,
            aggregationInterval,
            aggregationMethod,
            priceSegments,
            sampleType,
            usageIncrement,
            rounding,
            usageEntitlement,
            overageAllowed,
            dimensionUnitType,
            tiers,
            tiersGroupByMetadata,
        } = row;
        return new Numerical({
            numericalType,
            dimensionUnit,
            aggregationInterval,
            aggregationMethod,
            priceSegments: JSON.parse(priceSegments),
            sampleType,
            usageIncrement: parseInt(usageIncrement),
            rounding,
            usageEntitlement: usageEntitlement ? parseInt(usageEntitlement) : undefined,
            overageAllowed,
            dimensionUnitType,
            tiers: tiers ? JSON.parse(tiers) : undefined,
            tiersGroupByMetadata: tiersGroupByMetadata ? JSON.parse(tiersGroupByMetadata) : undefined,
        });
    };
}

/**
 * @author Developer One <developer.one@meteringco.example>
 *
 * @Class
 * The Dimension Entity represents the backend data format for the Dimensions.
 * Contained within are two important static methods.
 *
 * @function transformer
 *
 *  The transformation from the entity to the influx point array for writing to the DB.
 *
 * @function dbModelToEntity
 *
 * The transformation from the DB model to an entity. Specifically must only give a single row from the ledger
 *
 * These functions exist on almost all entities and deal with changing the entity to a compatible InfluxDB format and back.
 * These are useful during the reads and writes to and from the ledger in InfluxDB
 */
export class DimensionEntity {
    private static readonly logger = new Logger(DimensionEntity.name);
    public static _measurement = 'DimensionConfig';

    public dimensionId: string;

    public businessID: string;
    public typeofDimension: string;
    public dimensionName: string;
    public measurementId: string;
    public paymentSchedule?: PaymentSchedule;
    public infrastructureType: infrastructureType;
    public numerical: Numerical;
    public categorical: Categorical;
    public metadata?: Record<string, string | number | null>;

    constructor(entityInfo: DimensionEntity) {
        if (entityInfo) {
            const {
                typeofDimension,
                categorical,
                numerical,
                businessID,
                dimensionId,
                infrastructureType,
                dimensionName,
                measurementId,
                metadata,
                paymentSchedule,
            } = entityInfo;

            this.dimensionId = dimensionId;
            this.businessID = businessID;
            this.infrastructureType = infrastructureType;
            this.typeofDimension = typeofDimension;
            this.dimensionName = dimensionName;
            this.measurementId = measurementId;
            this.paymentSchedule = paymentSchedule;
            if (typeofDimension === 'numerical') {
                this.numerical = numerical;
            }
            if (typeofDimension === 'categorical') {
                this.categorical = categorical;
            }
            this.metadata = metadata;
        }
    }
    static transformer = (
        {
            dimensionId,
            businessID,
            typeofDimension,
            categorical,
            numerical,
            dimensionName,
            infrastructureType,
            measurementId,
            paymentSchedule,
            metadata,
        }: DimensionEntity,
        influxService: InfluxService,
    ): Point => {
        const dimensionEntityPoint = influxService.getPoint(DimensionEntity._measurement);

        dimensionEntityPoint.tag('dimensionId', dimensionId);
        dimensionEntityPoint.tag('businessID', businessID);
        dimensionEntityPoint.tag('measurementId', measurementId);
        dimensionEntityPoint.tag('infrastructureType', infrastructureType);
        dimensionEntityPoint.tag('typeofDimension', typeofDimension);
        if (paymentSchedule) {
            dimensionEntityPoint.tag('paymentSchedule', paymentSchedule);
        }
        if (typeofDimension === 'numerical') {
            Numerical.transformer(numerical, dimensionEntityPoint);
        }

        if (typeofDimension === 'catagorical') {
            Categorical.transformer(categorical, dimensionEntityPoint);
        }
        if (metadata) {
            dimensionEntityPoint.tag('metadata', JSON.stringify(metadata));
        }
        dimensionEntityPoint.stringField('dimensionName', dimensionName);

        return dimensionEntityPoint;
    };

    static dbModelToEntity(dbModel): DimensionEntity {
        const { _value, ...rest } = dbModel;

        const {
            infrastructureType,
            businessID,
            dimensionId,
            typeofDimension,
            measurementId,
            metadata: influxMetadata,
            paymentSchedule,
        } = rest;
        let numerical;
        let categorical;
        if (typeofDimension === 'numerical') {
            numerical = Numerical.dbModelToEntity(rest);
        }
        if (typeofDimension === 'categorical') {
            categorical = Categorical.dbModelToEntity(rest);
        }
        const input = {
            typeofDimension,
            infrastructureType,
            businessID,
            dimensionId,
            numerical,
            categorical,
            dimensionName: _value,
            measurementId,
            paymentSchedule: paymentSchedule ? paymentSchedule : PaymentSchedule.arrear,
            metadata: influxMetadata ? JSON.parse(influxMetadata) : undefined,
        };

        return new DimensionEntity(input);
    }
}
