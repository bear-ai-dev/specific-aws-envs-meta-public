import { Point } from '@influxdata/influxdb-client';
import { UserActiveEnvironment } from '../../influx/entities/userTable.entity.js';
import { InfluxService } from '../../influx/influx.service.js';
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
     * The environment a user is currently in is an append only record, the
     * latest row written for the subject wins. Writing a new row is therefore
     * all that moving between environments takes.
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
