import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Type } from '@nestjs/common';
import { Request, Response } from 'express';
import { claimCheck, InsufficientScopeError } from 'express-oauth2-jwt-bearer';
import { promisify } from 'util';
import { UserPermissions } from '../users/user.permissions.js';

function createPermissionsGuard(requiredRoutePermissions: string[]): Type<CanActivate> {
    @Injectable()
    class PermissionsGuardImpl implements CanActivate {
        async canActivate(context: ExecutionContext): Promise<boolean> {
            const request = context.switchToHttp().getRequest<Request>();
            const response = context.switchToHttp().getResponse<Response>();

            const permissionCheck = promisify(
                claimCheck((payload) => {
                    console.log('permissions check start');
                    const permissionsJwtClaim = (payload.permissions as string[]) || [];
                    if (permissionsJwtClaim.includes(UserPermissions.ADMIN)) {
                        return true;
                    }
                    const hasRequiredRoutePermissions = requiredRoutePermissions.every((requiredRoutePermission) =>
                        permissionsJwtClaim.includes(requiredRoutePermission),
                    );

                    if (!hasRequiredRoutePermissions) {
                        throw new InsufficientScopeError();
                    }
                    console.log('permissions check end');
                    return hasRequiredRoutePermissions;
                }),
            );

            try {
                request.auth = {
                    header: request.headers as any,
                    // eslint-disable-next-line
                    // @ts-ignore
                    payload: request?.user as any,
                    token: request.headers.authorization as any,
                };

                await permissionCheck(request, response);

                return true;
            } catch (error) {
                console.log(error, 'permissions error');
                throw new ForbiddenException('Permission denied');
            }
        }
    }

    return PermissionsGuardImpl;
}

export const PermissionsGuard = (routePermissions: string[]): Type<CanActivate> =>
    createPermissionsGuard(routePermissions);
