import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import {DatabaseModule} from "../database/database.module";
import {postProviders} from "./posts.provider";
import {UsersModule} from "../users/users.module";
import {MediaModule} from "../media/media.module";
import {mediaProviders} from "../media/media.provider";
import {CategoriesModule} from "../categories/categories.module";

@Module({
    imports: [DatabaseModule, UsersModule, MediaModule, CategoriesModule],
  controllers: [PostsController],
  providers: [PostsService, ...postProviders, ...mediaProviders],
    exports: [PostsService],
})
export class PostsModule {}
