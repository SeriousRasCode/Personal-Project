import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import {
  ListNotificationsQueryDto,
  UpdateNotificationPreferenceDto,
} from './dto/notification.dto.js';
import {
  NotificationListResponseDto,
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List your notifications, newest first' })
  @ApiResponse({ status: 200, type: NotificationListResponseDto })
  list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.listForUser(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count your unread notifications' })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'List your per channel notification preferences' })
  @ApiResponse({
    status: 200,
    type: [NotificationPreferenceResponseDto],
  })
  listPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listPreferences(user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Enable or disable a notification channel' })
  @ApiOkResponse({ type: NotificationPreferenceResponseDto })
  setPreference(
    @Body() input: UpdateNotificationPreferenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.setPreference(user.id, input);
  }

  @Patch(':notificationId/read')
  @ApiOperation({ summary: 'Mark one of your notifications as read' })
  @ApiOkResponse({ type: NotificationResponseDto })
  markRead(
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.markRead(user.id, notificationId);
  }
}
