import {
    BadRequestException,
    Body,
    CallHandler,
    Controller,
    Delete,
    ExecutionContext,
    Get,
    Headers,
    Inject,
    Injectable,
    NestInterceptor,
    Param,
    Post,
    Query,
    Request,
    UploadedFiles,
    UseGuards,
    UseInterceptors
} from '@nestjs/common';
import {PostsService} from './posts.service';
import {CreatePostDto} from './dto/create-post.dto';
import {UpdatePostDto} from './dto/update-post.dto';
import {ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiQuery, ApiTags} from "@nestjs/swagger";
import {FileFieldsInterceptor} from "@nestjs/platform-express";
import {Observable} from "rxjs";
import {Post as PostEntity} from './entities/post.entity';
import {map} from "rxjs/operators";
import {deleteFileFromUploads, handleUploadOnCreate, handleUploadOnUpdate,} from "../helpers/helper";
import {MediaService} from "../media/media.service";
import {CreateMediaDto} from "../media/dto/create-media.dto";
import {ILike, IsNull, Repository} from "typeorm";
import {CategoriesService} from "../categories/categories.service";
import {CreateTranslationDto} from "../translations/dto/create-translation.dto";
import {TranslationsService} from "../translations/translations.service";
import {UpdateTranslationDto} from "../translations/dto/update-translation.dto";
import {UsersService} from "../users/users.service";
import {AuthGuard} from "../auth/auth.guard";
import {User} from "../users/entities/user.entity";
import {GetPostTranslationDto} from "./dto/get-post-translation.dto";
import {UserPostHistoriesService} from "../user_post_histories/user_post_histories.service";

@Injectable()
export class MaxFileSizeInterceptor implements NestInterceptor {
    constructor() {
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const files = request.files;

        if (files) {
            this.checkForFiles(files, files.video, 100000000);
            this.checkForFiles(files, files.audio, 100000000);
            this.checkForFiles(files, files.image, 100000000);
            this.checkForFiles(files, files.pdf, 100000000);
        }

        if (files && files.images) {
            files.images.forEach((image) => {
                this.checkForFiles(files, image, 100000000);
            });
        }

        return next.handle().pipe(
            map((data) => {
                return data;
            }),
        );
    }

    checkForFiles(files, module, max_size) {
        if (files && module && module[0] && module[0].size > max_size) {
            throw new BadRequestException(`File size exceeds the limit of ${max_size} bytes`);
        }
    }
}

@ApiTags('Posts')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('posts')
export class PostsController {
    private readonly translated_columns: string[];
    private readonly languages: string[];
    private readonly lang_ids: {};
    constructor(
        private readonly postsService: PostsService,
        private readonly mediaService: MediaService,
        private readonly categoryService: CategoriesService,
        private readonly translationsService: TranslationsService,
        private readonly usersService: UsersService,
        private readonly userPostHistoriesService: UserPostHistoriesService,
        @Inject('POST_REPOSITORY')
        private postRepository: Repository<PostEntity>,
        @Inject('USER_REPOSITORY')
        private userRepository: Repository<User>,
    ) {
        this.translated_columns = ['title', 'description'];
        this.languages = ['en', 'ar'];
        this.lang_ids = {
            'en': 1,
            'ar': 2,
        };
    }

    @ApiConsumes('multipart/form-data')
    @ApiConsumes('application/json')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                title: {type: 'string'},
                description: {type: 'string'},
                url: {type: 'string'},
                date: {type: 'string'},
                time: {type: 'string'},
                video: {type: 'string', format: 'binary'},
                audio: {type: 'string', format: 'binary'},
                image: {type: 'string', format: 'binary'},
                pdf: {type: 'string', format: 'binary'},
                images: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                },
            }
        }
    })
    @UseInterceptors(
        FileFieldsInterceptor([
            {name: 'video', maxCount: 1},
            {name: 'audio', maxCount: 1},
            {name: 'image', maxCount: 1},
            {name: 'pdf', maxCount: 1},
            {name: 'images', maxCount: 100},
        ]),
        new MaxFileSizeInterceptor(),
    )
    @Post()
    async create(
        @Body() createPostDto: CreatePostDto,
        @UploadedFiles() files: {
            video?: Express.Multer.File[],
            audio?: Express.Multer.File[],
            image?: Express.Multer.File[],
            pdf?: Express.Multer.File[],
            images?: Express.Multer.File[],
        }
    ) {
        //file uploads
        if (files) {
            try {
                createPostDto.video = await handleUploadOnCreate(files, files.video, '/uploads/posts/videos/');
                createPostDto.audio = await handleUploadOnCreate(files, files.audio, '/uploads/posts/audios/');
                createPostDto.image = await handleUploadOnCreate(files, files.image, '/uploads/posts/images/');
                createPostDto.pdf = await handleUploadOnCreate(files, files.pdf, '/uploads/posts/pdfs/');
            } catch (error) {
                throw new BadRequestException(error.message);
            }
        }

        let title_ar = createPostDto.title_ar
        let description_ar = createPostDto.description_ar

        delete createPostDto.title_ar;
        delete createPostDto.description_ar;

        createPostDto.created_at = Date.now().toString();
        let res = await this.postsService.create(createPostDto);

        createPostDto.title_ar = title_ar;
        createPostDto.description_ar = description_ar;

        //translation work
        if (!res.error) {
            await this.createTranslation('post', res.id, 1, 'title', createPostDto.title);
            await this.createTranslation('post', res.id, 1, 'description', createPostDto.description);

            await this.createTranslation('post', res.id, 2, 'title', createPostDto.title_ar);
            await this.createTranslation('post', res.id, 2, 'description', createPostDto.description_ar);
        }

        //if category in string
        if (createPostDto.category_ids && typeof createPostDto.category_ids[0] == 'string' && createPostDto.category_ids.length > 0) {
            let string = createPostDto.category_ids.toString();
            createPostDto.category_ids = string.split(',').map(Number);
        }

        //attach categories
        if (createPostDto.category_ids && createPostDto.category_ids.length > 0) {
            let post = await this.postRepository.findOne({
                where: {
                    id: res.id
                }
            });

            post.categories = await Promise.all(
                createPostDto.category_ids.map(async (category_id) => {
                    console.log(category_id);
                    let category = await this.categoryService.findOne(+category_id);

                    if (!category.error) {
                        return category;
                    }
                }).filter((item) => {
                    return item !== null && item !== undefined;
                })
            );
            await this.postRepository.save(post);
        }

        //multiple image upload
        if (files && files.images) {
            try {
                await Promise.all(
                    files.images.map(async (file) => {
                        let createMediaDto = new CreateMediaDto();
                        createMediaDto.module = 'post';
                        createMediaDto.module_id = res.id;
                        createMediaDto.url = await handleUploadOnCreate(files, file, '/uploads/posts/images/', false); //use false for multiple images
                        createMediaDto.created_at = Date.now().toString();

                        await this.mediaService.create(createMediaDto);
                    })
                );
            } catch (error) {
                throw new BadRequestException(error.message);
            }
        }

        res = await this.postsService.findOne(res.id);

        return {
            success: !res.error,
            message: res.error ? res.error : 'Post created successfully!',
            data: res.error ? [] : res,
        }
    }

    @ApiHeader({ name: 'lang', required: false})
    @ApiQuery({ name: 'page', required: false})
    @ApiQuery({ name: 'limit', required: false})
    @ApiQuery({ name: 'category_id', required: false})
    @ApiQuery({ name: 'title', required: false})
    @Get()
    async findAll(
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('category_id') category_id?: number,
        @Query('title') title?: string,
        @Headers('lang') lang?: number
    ) {
        let where_object = {
            where: {}
        };

        if (category_id) {
            let category = await this.categoryService.findOne(category_id);
            if (category.error) {
                return {
                    success: false,
                    message: category.error,
                    data: [],
                }
            }

            where_object['where']['categories'] = { id: category_id }
        }

        if (title) {
            where_object['where']['translations'] = {  module: 'post', key: 'title', 'value': ILike(`%${title}%`)  }
        }

        let res = await this.postsService.findAll(page, limit, {
            relations: ['images', 'categories.children'],
            ...where_object
        });

        //translation work
        let language_id = lang ?? 1;
        if(res.data) {
            //get preferred language
            res.data = await this.addPreferredTranslationToArray(res.data, language_id);

            //get translated columns
            res.data = await this.addTranslatedColumnsToArray(res.data);
        }

        return {
            success: true,
            message: '',
            ...res
        }
    }

    @ApiHeader({ name: 'lang', required: false})
    @Get('get/featured-posts')
    async findAllFeatured(@Headers('lang') lang?: number) {

        let res = await this.postsService.findAll(1, 10, {
            relations: ['images', 'categories.children'],
            where: {
                is_featured: 1
            },
            order: {
                created_at: 'DESC'
            }
        });

        //translation work
        let language_id = lang ?? 1;
        if(res.data) {
            //get preferred language
            res.data = await this.addPreferredTranslationToArray(res.data, language_id);

            //get translated columns
            res.data = await this.addTranslatedColumnsToArray(res.data);
        }

        return {
            success: true,
            message: '',
            ...res
        }
    }

    @ApiHeader({ name: 'lang', required: false})
    @ApiQuery({ name: 'category_id', required: false})
    @ApiQuery({ name: 'title', required: false})
    @Get('/screen-wise')
    async findAllScreenWise(@Query('category_id') category_id?: number, @Query('title') title?: string, @Headers('lang') lang?: number) {
        let video_where_object = { where: {} };
        let audio_where_object = { where: {} };
        let image_where_object = { where: {} };
        let pdf_where_object = { where: {} };
        let language_id = lang ?? 1;

        if (category_id) {
            let category = await this.categoryService.findOne(category_id);
            if (category.error) {
                return {
                    success: false,
                    message: category.error,
                    data: [],
                }
            }

            video_where_object.where['categories'] = { id: category_id };
            audio_where_object.where['categories'] = { id: category_id };
            image_where_object.where['categories'] = { id: category_id };
            pdf_where_object.where['categories'] = { id: category_id };
        }

        if (title) {
            video_where_object.where['translations'] = { module: 'post', key: 'title', 'value': ILike(`%${title}%`) };
            audio_where_object.where['translations'] = { module: 'post', key: 'title', 'value': ILike(`%${title}%`) };
            image_where_object.where['translations'] = { module: 'post', key: 'title', 'value': ILike(`%${title}%`) };
            pdf_where_object.where['translations'] = { module: 'post', key: 'title', 'value': ILike(`%${title}%`) };
        }

        video_where_object.where['video'] = !IsNull();
        let videos = await this.postsService.findAllNoPagination({
            relations: ['images', 'categories.children'],
            ...video_where_object
        });
        //get preferred language
        videos = await this.addPreferredTranslationToArray(videos, language_id);
        //get translated columns
        videos = await this.addTranslatedColumnsToArray(videos);


        audio_where_object.where['audio'] = !IsNull();
        let audios = await this.postsService.findAllNoPagination({
            relations: ['images', 'categories.children'],
            ...audio_where_object
        });
        //get preferred language
        audios = await this.addPreferredTranslationToArray(audios, language_id);
        //get translated columns
        audios = await this.addTranslatedColumnsToArray(audios);

        image_where_object.where['image'] = !IsNull();
        let images = await this.postsService.findAllNoPagination({
            relations: ['images', 'categories.children'],
            ...image_where_object
        });
        //get preferred language
        images = await this.addPreferredTranslationToArray(images, language_id);
        //get translated columns
        images = await this.addTranslatedColumnsToArray(images);

        pdf_where_object.where['pdf'] = !IsNull();
        let pdfs = await this.postsService.findAllNoPagination({
            relations: ['images', 'categories.children'],
            ...pdf_where_object
        });
        //get preferred language
        pdfs = await this.addPreferredTranslationToArray(pdfs, language_id);
        //get translated columns
        pdfs = await this.addTranslatedColumnsToArray(pdfs);

        return {
            success: true,
            message: '',
            data: {
                videos,
                audios,
                images,
                pdfs,
            }
        }
    }

    @ApiHeader({ name: 'lang', required: false})
    @Get(':id')
    async findOne(@Param('id') id: string, @Headers('lang') lang?: number) {
        let res = await this.postsService.findOne(+id);

        //translation work
        if (!res.error) {
            let language_id = lang ?? 1;

            //get preferred language translation
            res = await this.addPreferredTranslation(res, language_id);

            //add translated columns
            res = await this.addTranslatedColumns(res);
        }

        if (!res.error) {
            //translation work
            let language_id = lang ?? 1;
            for (const key of this.translated_columns) {
                let record = await this.translationsService.findOneWhere({
                    where: {
                        module: 'post',
                        module_id: res.id,
                        language_id: language_id,
                        key: key,
                    },
                });

                res[key] = record.value ?? res[key];
            }
        }

        return {
            success: !res.error,
            message: res.error ? res.error : '',
            data: res.error ? [] : res,
        }
    }

    @ApiHeader({ name: 'lang', required: false})
    @ApiQuery({ name: 'page', required: false})
    @ApiQuery({ name: 'limit', required: false})
    @Get('/get/post-history')
    async postHistory (
        @Request() req,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Headers('lang') lang?: number,
    ) {
        let res = await this.userPostHistoriesService.findAll(page, limit, {
            where: {
                user_id: req.user.id
            },
            order: {
                created_at: 'DESC'
            }
        });

        res.data = await Promise.all(
            res.data.map(async (user_post_history) => {
                let post = await this.postsService.findOne(user_post_history.post_id)

                if (!post.error) {
                    return post;
                }
            })
        );


        //translation work
        let language_id = lang ?? 1;
        if(res.data) {
            //get preferred language
            res.data = await this.addPreferredTranslationToArray(res.data, language_id);

            //get translated columns
            res.data = await this.addTranslatedColumnsToArray(res.data);
        }

        return {
            success: true,
            message: '',
            ...res
        }
    }

    @ApiConsumes('multipart/form-data')
    @ApiConsumes('application/json')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {video: {type: 'string', format: 'binary'},
                audio: {type: 'string', format: 'binary'},
                image: {type: 'string', format: 'binary'},
                pdf: {type: 'string', format: 'binary'},
                images: {
                    type: 'array',
                    items: { type: 'string', format: 'binary'},
                },
            }
        }
    })
    @UseInterceptors(
        FileFieldsInterceptor([
            {name: 'video', maxCount: 1},
            {name: 'audio', maxCount: 1},
            {name: 'image', maxCount: 1},
            {name: 'pdf', maxCount: 1},
            {name: 'images', maxCount: 100},
        ]),
        new MaxFileSizeInterceptor(),
    )
    @Post(':id')
    async update(
        @Param('id') id: number, @Body() updatePostDto: UpdatePostDto, @UploadedFiles() files: {
            video?: Express.Multer.File[],
            audio?: Express.Multer.File[],
            image?: Express.Multer.File[],
            pdf?: Express.Multer.File[],
            images?: Express.Multer.File[],
        }
    ) {
        let post = await this.postsService.findOne(+id);
        if (post.error) {
            return {
                success: false,
                message: post.error,
                data: [],
            }
        }

        //file uploads
        try {
            if (files) {
                updatePostDto.video = await handleUploadOnUpdate(files, files.video, post.video, '/uploads/posts/videos/');
                updatePostDto.audio = await handleUploadOnUpdate(files, files.audio, post.audio, '/uploads/posts/audios/');
                updatePostDto.image = await handleUploadOnUpdate(files, files.image, post.image, '/uploads/posts/images/');
                updatePostDto.pdf = await handleUploadOnUpdate(files, files.pdf, post.pdf, '/uploads/posts/pdfs/');
            }

            //multiple image upload
            if (files && files.images) {
                await Promise.all(
                    files.images.map(async (file) => {
                        let createMediaDto = new CreateMediaDto();
                        createMediaDto.module = 'post';
                        createMediaDto.module_id = post.id;
                        createMediaDto.url = await handleUploadOnCreate(files, file, '/uploads/posts/images/', false);
                        createMediaDto.created_at = Date.now().toString();

                        await this.mediaService.create(createMediaDto);
                    })
                );
            }
        }
         catch (error) {
            throw new BadRequestException(error.message);
        }

        let title_ar = updatePostDto.title_ar
        let description_ar = updatePostDto.description_ar
        let images = updatePostDto.images;

        delete updatePostDto.title_ar;
        delete updatePostDto.description_ar;
        delete updatePostDto.images;

        let res = await this.postsService.update(+id, updatePostDto);

        updatePostDto.title_ar = title_ar;
        updatePostDto.description_ar = description_ar;
        updatePostDto.images = images;

        //translation work
        if (!res.error) {
            await this.updateTranslation('post', res.id, 1, 'title', updatePostDto.title);
            await this.updateTranslation('post', res.id, 1, 'description', updatePostDto.description);

            await this.updateTranslation('post', res.id, 2, 'title', updatePostDto.title_ar);
            await this.updateTranslation('post', res.id, 2, 'description', updatePostDto.description_ar);
        }

        //if category in string
        if (updatePostDto.category_ids && typeof updatePostDto.category_ids[0] == 'string' && updatePostDto.category_ids.length > 0) {
            let string = updatePostDto.category_ids.toString();
            updatePostDto.category_ids = string.split(',').map(Number);
        }

        //attach categories
        if (updatePostDto.category_ids) {
            let post = await this.postRepository.findOne({
                where: {
                    id: id
                }
            });

            post.categories = await Promise.all(
                updatePostDto.category_ids.map(async (category_id) => {
                    let category = await this.categoryService.findOne(+category_id);

                    if (!category.error) {
                        return category;
                    }
                }).filter((item) => {
                    return item !== null && item !== undefined;
                })
            );

            await this.postRepository.save(post);
        }

        return {
            success: !res.error,
            message: res.error ? res.error : 'Post updated successfully!',
            data: res.error ? [] : res,
        }
    }

    @Post(':id/mark-as-featured')
    async markAsFeatured (@Param('id') id: number, @Body() updatePostDto: UpdatePostDto) {
        let post = await this.postsService.findOne(+id);
        if (post.error) {
            return {
                success: false,
                message: post.error,
                data: [],
            }
        }

        post.is_featured = updatePostDto.is_featured;
        console.log(updatePostDto);
        await this.postRepository.save(post)

        return {
            success: true,
            message: 'Post marked successfully!',
            data: []
        }
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        let post = await this.postsService.findOne(+id);
        if (post.error) {
            return {
                success: false,
                message: post.error,
                data: [],
            }
        }

        // Delete uploaded file
        let app_url = process.env.APP_URL + ':' + process.env.PORT;
        await deleteFileFromUploads(app_url, post.video);
        await deleteFileFromUploads(app_url, post.audio);
        await deleteFileFromUploads(app_url, post.image);
        await deleteFileFromUploads(app_url, post.pdf);

        //multiple image delete
        let media_res = await this.mediaService.findAll(1, 1000, {
           where: {
               module: 'post',
               module_id: post.id,
           }
        });

        await Promise.all(
            media_res.data.map(async (media) => {
                await this.mediaService.remove(media.id);
            })
        );

        let res = await this.postsService.remove(+id);

        //translation work
        let languages = [1, 2];
        for (const language_id of languages) {
            for (const key of this.translated_columns) {
                let record = await this.translationsService.findOneWhere({
                    where: {
                        module: 'post',
                        module_id: id,
                        language_id: language_id,
                        key: key,
                    },
                });
                if (!record.error) {
                    await this.translationsService.remove(record.id);
                }
            }
        }

        return {
            success: !res.error,
            message: res.error ? res.error : 'Post deleted successfully!',
            data: res.error ? [] : res,
        }
    }

    @ApiHeader({ name: 'lang', required: false})
    @Get('category-post/:id')
    async findByCategoryById(@Param('id') id: string, @Headers('lang') lang?: number) {
        let res = await this.postsService.findAllByCategory(+id,1, 1000);

        //translation work
        let language_id = lang ?? 1;
        if(res.data) {
            //get preferred language
            res.data = await this.addPreferredTranslationToArray(res.data, language_id);

            //get translated columns
            res.data = await this.addTranslatedColumnsToArray(res.data);
        }

        return {
            success: !res.error,
            message: res.error ? res.error : '',
            data: res.error ? [] : res,
        }
    }

    @Post('add-to-favourites/:id')
    async addToFavourites (@Param('id') id: string, @Request() req) {
        let post = await this.postsService.findOne(+id);
        if (post.error) {
            return {
                success: false,
                message: post.error,
                data: [],
            };
        }

        let user = await this.usersService.findOne(+req.user.id);
        let favourite_posts;
        if (user.favourite_posts == null) {
            favourite_posts = [];
        } else {
            favourite_posts = JSON.parse(user.favourite_posts);
        }
        let post_found = !!favourite_posts.includes(+id);

        if (post_found) {
            favourite_posts = favourite_posts.filter((post_id) => {
                return post_id != id;
            });
        } else {
            favourite_posts.push(+id);
        }

        user.favourite_posts = JSON.stringify(favourite_posts);
        await this.userRepository.save(user);

        return {
            success: true,
            message: (post_found ? 'Removed from ' : 'Added to ') + 'favourites!',
            data: []
        };
    }

    @ApiHeader({ name: 'lang', required: false})
    @Get('favourites/list')
    async favouritesList (@Request() req, @Headers('lang') lang?: number) {
        let user = await this.usersService.findOne(+req.user.id);

        let favourite_posts;
        if (user.favourite_posts == null) {
            favourite_posts = [];
        } else {
            favourite_posts = JSON.parse(user.favourite_posts);
        }

        favourite_posts = await Promise.all(
            favourite_posts.map(async (post_id) => {
                let post = await this.postsService.findOne(post_id);

                if (!post.error) {
                    return post;
                }
            })
        );

        favourite_posts = favourite_posts.filter((item) => item !== null && item !== undefined);

        //sort by created_at
        favourite_posts = favourite_posts.sort((a, b) => {
            let keyA = a.created_at,
                keyB = b.created_at;
            // Compare the 2 dates
            if (keyA > keyB) return -1;
            if (keyA < keyB) return 1;
            return 0;
        });

        //translation work
        let language_id = lang ?? 1;
        if(favourite_posts) {
            //get preferred language
            favourite_posts = await this.addPreferredTranslationToArray(favourite_posts, language_id);

            //get translated columns
            favourite_posts = await this.addTranslatedColumnsToArray(favourite_posts);
        }

        return {
            success: true,
            message: '',
            data: favourite_posts
        };
    }

    @Get('favourites/post-ids')
    async favouritePostIds (@Request() req) {
        let user = await this.usersService.findOne(+req.user.id);

        let favourite_posts;
        if (user.favourite_posts == null) {
            favourite_posts = [];
        } else {
            favourite_posts = JSON.parse(user.favourite_posts);
        }

        return {
            success: true,
            message: '',
            data: favourite_posts
        };
    }

    @Post('translation/get')
    async getTranslation (@Body() getPostTranslationDto: GetPostTranslationDto) {
        let res = await this.translationsService.findOneWhere({
            where: {
                module: 'post',
                module_id: getPostTranslationDto.module_id,
                language_id: getPostTranslationDto.language_id,
                key: getPostTranslationDto.key,
            }
        })

        return {
            success: !res.error,
            message: res.error ? res.error : '',
            data: res.error ? [] : res,
        }
    }

    async createTranslation (module: string, module_id: number, language_id: number, key: string, value: string) {
        if (value == null) {
            return null;
        }

        let createTranslationDto = new CreateTranslationDto();
        createTranslationDto.module = module;
        createTranslationDto.module_id = module_id;
        createTranslationDto.language_id = language_id;
        createTranslationDto.key = key;
        createTranslationDto.value = value;
        return await this.translationsService.create(createTranslationDto);
    }

    async updateTranslation (module: string, module_id: number, language_id: number, key: string, value: string) {
        if (value == null) {
            return null;
        }

        let res = await this.translationsService.findOneWhere({
            where: {
                module: module,
                module_id: module_id,
                language_id: language_id,
                key: key
            }
        });

        if (!res.error) {
            let updateTranslationDto = new UpdateTranslationDto();
            updateTranslationDto.value = value;
            return await this.translationsService.update(res.id, updateTranslationDto);
        } else {
            return await this.createTranslation(module, module_id, language_id, key, value);
        }
    }

    async addPreferredTranslation (record, language_id) {
        for (const key of this.translated_columns) {
            let res = await this.translationsService.findOneWhere({
                where: {
                    module: 'post',
                    module_id: record.id,
                    language_id: language_id,
                    key: key,
                },
            });

            record[key] = res.value ?? record[key];
        }

        return record;
    }

    async addPreferredTranslationToArray (array, language_id) {
        return await Promise.all(
            array.map(async (item) => {
                //get preferred language translation
                item = await this.addPreferredTranslation(item, language_id);
                return item;
            })
        );
    }

    async addTranslatedColumns (record) {
        for (const language of this.languages) {
            for (const key of this.translated_columns) {
                let res = await this.translationsService.findOneWhere({
                    where: {
                        module: 'post',
                        module_id: record.id,
                        language_id: this.lang_ids[language],
                        key: key,
                    },
                });

                record[key + '_' + language] = res.value ?? record[key];
            }
        }

        return record;
    }

    async addTranslatedColumnsToArray (array) {
        return await Promise.all(
            array.map(async (item) => {
                //add translated columns
                item = await this.addTranslatedColumns(item);
                return item;
            })
        );
    }
}
