import {MiddlewareConsumer, Module} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import {UsersModule} from "./users/users.module";
import {AuthModule} from "./auth/auth.module";
import {MailModule} from "./mail/mail.module";
import {GroupsModule} from "./groups/groups.module";
import {GroupRequestsModule} from "./group-requests/group-requests.module";
import {NotificationsModule} from "./notifications/notifications.module";
import {MessagesModule} from "./messages/messages.module";
import {ContactsModule} from "./contacts/contacts.module";
import {AbusiveWordsMiddleware} from "./middlewares/abusiveWords.middleware";
import { FaqModule } from './faq/faq.module';
import { PostsModule } from './posts/posts.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
      ConfigModule.forRoot(),
      UsersModule,
      AuthModule,
      ContactsModule,
      MailModule,
      GroupsModule,
      MessagesModule,
      NotificationsModule,
      GroupRequestsModule,
      FaqModule,
      PostsModule,
      MediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AbusiveWordsMiddleware).forRoutes('*');
    }
}
