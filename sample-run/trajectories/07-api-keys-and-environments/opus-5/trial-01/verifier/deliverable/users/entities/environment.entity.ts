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

    /**
     * Should not use `this` context, is a pure transformation of the data and doesn't alter the state.
     *
     * The active environment of a user is the latest row written for their subject, which is what
     * makes a move between environments visible to the very next request rather than eventually.
     */
    static transformer(environmentEntity: EnvironmentEntity, influxService: InfluxService): Array<Point> {
        const environmentPoint = influxService.getPoint(EnvironmentEntity._measurement);
        environmentPoint.tag('subject', environmentEntity.subject);
        environmentPoint.stringField('environment', environmentEntity.environment);

        return [environmentPoint];
    }

    static dbModelToEntity(dbModel: UserActiveEnvironment) {
        return new EnvironmentEntity({
            subject: dbModel.subject,
            environment: dbModel._value,
        });
    }
}
