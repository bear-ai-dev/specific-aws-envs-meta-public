import { Point } from '@influxdata/influxdb-client';
import { InfluxService } from '../../influx/influx.service.js';
import { UserActiveEnvironment } from '../../influx/entities/userTable.entity.js';
import { Environment } from '../dto/Environment.js';

export class EnvironmentEntity {
    public static _measurement = 'UserActiveEnvironment';
    public subject: string;
    public environment: Environment;

    constructor({ subject, environment }: { subject: string; environment?: Environment }) {
        this.subject = subject;
        this.environment = environment ? environment : Environment.PRODUCTION;
    }

    static dbModelToEntity(dbModel: UserActiveEnvironment) {
        return new EnvironmentEntity({
            subject: dbModel.subject,
            environment: dbModel._value,
        });
    }

    /**
     * Turns the currently selected environment of a caller into the row which is committed to the
     * configuration store. The row is written under the callers subject so that the very next
     * request made by that caller reads it back.
     */
    static transformer(environmentEntity: EnvironmentEntity, influxService: InfluxService): Array<Point> {
        const environmentPoint = influxService.getPoint(EnvironmentEntity._measurement);
        environmentPoint.tag('subject', environmentEntity.subject);
        environmentPoint.stringField('environment', environmentEntity.environment);

        return [environmentPoint];
    }
}
