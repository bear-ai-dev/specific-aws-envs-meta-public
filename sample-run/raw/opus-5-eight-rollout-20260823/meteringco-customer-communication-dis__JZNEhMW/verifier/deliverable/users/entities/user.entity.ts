import { Point } from '@influxdata/influxdb-client';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { InfluxService } from '../../influx/influx.service.js';
import { fetch } from 'cross-fetch';
import { Logger } from '@nestjs/common';
import { Environment } from '../dto/Environment.js';
import { UserTable } from '../../influx/entities/userTable.entity.js';

export class UserEntity {
    private static readonly logger = new Logger(UserEntity.name);
    public static _measurement = 'UserData';
    public static _measurementActiveEnvironment = 'UserDataEnv';
    subject: string;
    businessID: string;
    accountExpiryDate: string;
    temp: boolean;
    environment: Environment;
    softDelete: string;

    constructor({
        subject,
        businessID,
        accountExpiryDate,
        temp,
        environment,
        softDelete,
    }: {
        subject: string;
        businessID: string;
        accountExpiryDate?: string;
        temp?: boolean;
        environment?: Environment;
        softDelete?: string;
    }) {
        this.subject = subject;
        this.businessID = businessID;
        this.accountExpiryDate = accountExpiryDate;
        this.temp = temp;
        this.environment = environment;
        this.softDelete = softDelete;
    }

    // Should not use `this` context is a pure transformation of the data and doesn't alter the state
    static transformer(userEntity: UserEntity, influxService: InfluxService): Array<Point> {
        // Take in a pricing package entity
        // Return a collection of points to be commited to TSDB

        const userPoint = influxService.getPoint(UserEntity._measurementActiveEnvironment);
        userPoint.tag('subject', userEntity.subject);
        userPoint.tag('businessID', userEntity.businessID);
        userPoint.tag('accountExpiryDate', userEntity.accountExpiryDate);
        if (userEntity.temp) {
            userPoint.tag('temp', userEntity.temp.toString());
        }
        if (userEntity.environment) {
            userPoint.tag('environment', userEntity.environment);
        }
        if (userEntity.softDelete) {
            userPoint.tag('softDelete', userEntity.softDelete);
        }

        userPoint.stringField('userStatus', 'live');

        return [userPoint];
    }

    static dbModelToEntity(dbModel: Array<UserTable>) {
        const [{ subject, accountExpiryDate, temp, businessID, environment }] = dbModel;
        return new UserEntity({
            subject,
            businessID,
            accountExpiryDate,
            temp,
            environment,
        });
    }

    public static async updateUserPermissions(
        userEntity: UserEntity,
        access_token,
        permission: string | Array<string>,
    ) {
        let data;
        if (permission && Array.isArray(permission)) {
            data = JSON.stringify({
                permissions: permission.map((p) => ({
                    resource_server_identifier: 'https://example1234.execute-api.us-east-1.amazonaws.com',
                    permission_name: p,
                })),
            });
        } else {
            data = JSON.stringify({
                permissions: [
                    {
                        resource_server_identifier: 'https://example1234.execute-api.us-east-1.amazonaws.com',
                        permission_name: permission,
                    },
                ],
            });
        }

        UserEntity.logger.debug(`Updating user permissions for ${userEntity?.subject}`);
        const res = await fetch(
            `https://auth.meteringco.example/api/v2/users/${encodeURIComponent(userEntity?.subject)}/permissions`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${access_token}`,
                    'cache-control': 'no-cache',
                },
                body: data,
            },
        );
        const jsonRes = await res.json();
        if (jsonRes?.error) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Error updating auth0 user permissions',
                data: [jsonRes],
            });
            throw new Error('Error updating auth0 user permissions');
        }
        return jsonRes;
    }
}
