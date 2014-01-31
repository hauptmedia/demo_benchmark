define(
	'Benchmarks/systems/box2dPhysics',
	[
        'Benchmarks/physics/initBox2d',
		'spell/Defines',
		'spell/math/util',
		'spell/shared/util/platform/PlatformKit',

		'spell/functions'
	],
	function(
        initBox2d,

		Defines,
		mathUtil,
		PlatformKit,

		_
	) {
		'use strict'


		var Box2D                   = PlatformKit.Box2D,
			b2_staticBody           = Box2D.Dynamics.b2Body.b2_staticBody,
			createB2Vec2            = Box2D.Common.Math.createB2Vec2,
			createB2FixtureDef      = Box2D.Dynamics.createB2FixtureDef,
			createB2ContactListener = Box2D.Dynamics.createB2ContactListener,
			createB2PolygonShape    = Box2D.Collision.Shapes.createB2PolygonShape,
			createB2CircleShape     = Box2D.Collision.Shapes.createB2CircleShape

		var entityEventBeginContact = function( entityManager, contactTriggers, eventId, contact, manifold ) {
			var entityIdA = contact.GetFixtureA().GetUserData(),
				entityIdB = contact.GetFixtureB().GetUserData(),
				contactTrigger

			if( entityIdA ) {
				entityManager.triggerEvent( entityIdA, eventId, [ entityIdB, contact, manifold ] )

				contactTrigger = contactTriggers[ entityIdA ]

				if( contactTrigger && entityIdB ) {
					entityManager.triggerEvent( entityIdB, contactTrigger.eventId, [ entityIdA ].concat( contactTrigger.parameters ) )
				}
			}

			if( entityIdB ) {
				entityManager.triggerEvent( entityIdB, eventId, [ entityIdA, contact, manifold ] )

				contactTrigger = contactTriggers[ entityIdB ]

				if( contactTrigger && entityIdA ) {
					entityManager.triggerEvent( entityIdA, contactTrigger.eventId, [ entityIdB ].concat( contactTrigger.parameters ) )
				}
			}
		}

		var entityEventEndContact = function( entityManager, eventId, contact, manifold ) {
			var entityIdA = contact.GetFixtureA().GetUserData(),
				entityIdB = contact.GetFixtureB().GetUserData()
			if( entityIdA ) {
				entityManager.triggerEvent( entityIdA, eventId, [ entityIdB, contact, manifold ] )
			}

			if( entityIdB ) {
				entityManager.triggerEvent( entityIdB, eventId, [ entityIdA, contact, manifold ] )
			}
		}

		var createContactListener = function( entityManager, contactTriggers ) {
			return createB2ContactListener(
				function( contact, manifold ) {
					entityEventBeginContact( entityManager, contactTriggers, 'beginContact', contact, manifold )
				},
				function( contact, manifold ) {
					entityEventEndContact( entityManager, 'endContact', contact, manifold )
				},
				null,
				null
			)
		}

		var createBody = function( spell, debug, world, entityId, entity ) {
			var body               = entity[ Defines.PHYSICS_BODY_COMPONENT_ID ],
				fixture            = entity[ Defines.PHYSICS_FIXTURE_COMPONENT_ID ],
				boxShape           = entity[ Defines.PHYSICS_BOX_SHAPE_COMPONENT_ID ],
				circleShape        = entity[ Defines.PHYSICS_CIRCLE_SHAPE_COMPONENT_ID ],
				convexPolygonShape = entity[ Defines.PHYSICS_CONVEX_POLYGON_SHAPE_COMPONENT_ID ],
				transform          = entity[ Defines.TRANSFORM_COMPONENT_ID ]

			if( !body || !fixture || !transform ||
				( !boxShape && !circleShape && !convexPolygonShape ) ) {

				return
			}

			createPhysicsObject( world, entityId, body, fixture, boxShape, circleShape, convexPolygonShape, transform )
		}

		var destroyBodies = function( world, entityIds ) {
			for( var i = 0, numEntityIds = entityIds.length; i < numEntityIds; i++ ) {
				world.destroyBody( entityIds[ i ] )
			}
		}

		var addShape = function( world, worldToPhysicsScale, entityId, bodyDef, fixture, boxShape, circleShape, convexPolygonShape ) {
			var fixtureDef = createB2FixtureDef()

			fixtureDef.density     = fixture.density
			fixtureDef.friction    = fixture.dynamicFriction
			fixtureDef.restitution = fixture.elasticity
			fixtureDef.isSensor    = fixture.isSensor
			fixtureDef.userData    = entityId

			fixtureDef.filter.categoryBits = fixture.categoryBits
			fixtureDef.filter.maskBits     = fixture.maskBits

			if( boxShape ) {
				fixtureDef.shape = createB2PolygonShape()
				fixtureDef.shape.SetAsBox(
					boxShape.dimensions[ 0 ] / 2 * worldToPhysicsScale,
					boxShape.dimensions[ 1 ] / 2 * worldToPhysicsScale
				)

				bodyDef.CreateFixture( fixtureDef )

			} else if( circleShape ) {
				fixtureDef.shape = createB2CircleShape( circleShape.radius * worldToPhysicsScale )

				bodyDef.CreateFixture( fixtureDef )

			} else if( convexPolygonShape ) {
				var vertices = convexPolygonShape.vertices

				fixtureDef.shape = createB2PolygonShape()
				fixtureDef.shape.SetAsArray(
					_.map(
						vertices,
						function( x ) { return createB2Vec2( x[ 0 ] * worldToPhysicsScale, x[ 1 ] * worldToPhysicsScale ) }
					),
					vertices.length
				)

				bodyDef.CreateFixture( fixtureDef )
			}
		}

		var createPhysicsObject = function( world, entityId, body, fixture, boxShape, circleShape, convexPolygonShape, transform ) {
			var bodyDef = world.createBodyDef( entityId, body, transform )

			if( !bodyDef ) return

			addShape( world, world.scale, entityId, bodyDef, fixture, boxShape, circleShape, convexPolygonShape )
		}

		var step = function( rawWorld, deltaTimeInMs ) {
			rawWorld.Step( deltaTimeInMs / 1000, 10, 8 )
			rawWorld.ClearForces()
		}

		var incrementState = function( entityManager, world, invWorldToPhysicsScale, bodies, transforms ) {
			for( var body = world.GetBodyList(); body; body = body.GetNext() ) {
				if( body.GetType() == b2_staticBody ||
					!body.IsAwake() ) {

					continue
				}

				var id = body.GetUserData()
				if( !id ) continue

				// transfering state to components
				var position  = body.GetPosition(),
					transform = transforms[ id ]

				if( !transform ) continue

				transform.translation[ 0 ] = position.x * invWorldToPhysicsScale
				transform.translation[ 1 ] = position.y * invWorldToPhysicsScale
				transform.rotation = body.GetAngle() * 1

				entityManager.updateWorldTransform( id )

				// updating velocity
				var velocity = body.GetLinearVelocity(),
					bodyComponent = bodies[ id ],
					maxVelocity   = bodyComponent.maxVelocity

				if( maxVelocity ) {
					// clamping velocity to range
					var maxVelocityX = maxVelocity[ 0 ],
						maxVelocityY = maxVelocity[ 1 ]

					velocity.x = mathUtil.clamp( velocity.x, -maxVelocityX, maxVelocityX )
					velocity.y = mathUtil.clamp( velocity.y, -maxVelocityY, maxVelocityY )

					body.SetLinearVelocity( velocity )
				}

				bodyComponent.velocity[ 0 ] = velocity.x * invWorldToPhysicsScale
				bodyComponent.velocity[ 1 ] = velocity.y * invWorldToPhysicsScale
			}
		}

		var init = function( spell ) {
            if( !this.config.active ) return

            initBox2d(spell)

			this.world = spell.physicsWorlds.main

            var doSleep = true,
                world   = spell.box2dContext.createWorld( doSleep, this.config.gravity, this.config.scale )

            world.getRawWorld().SetContactListener(
                createContactListener( spell.entityManager, this.contactTriggers )
            )

            this.world = world
            spell.physicsWorlds.main = world

			this.entityCreatedHandler = _.bind( createBody, null, spell, this.config.debug, this.world )
			this.entityDestroyHandler = _.bind( this.removedEntitiesQueue.push, this.removedEntitiesQueue )

			var eventManager = spell.eventManager

			eventManager.subscribe( eventManager.EVENT.ENTITY_CREATED, this.entityCreatedHandler )
			eventManager.subscribe( eventManager.EVENT.ENTITY_REMOVED, this.entityDestroyHandler )
		}

		var destroy = function( spell ) {
			var eventManager = spell.eventManager

			eventManager.unsubscribe( eventManager.EVENT.ENTITY_CREATED, this.entityCreatedHandler )
			eventManager.unsubscribe( eventManager.EVENT.ENTITY_REMOVED, this.entityDestroyHandler )
		}

		var process = function( spell, timeInMs, deltaTimeInMs ) {
			var world                = this.world,
				rawWorld             = this.world.getRawWorld(),
				transforms           = this.transforms,
				removedEntitiesQueue = this.removedEntitiesQueue

			if( removedEntitiesQueue.length ) {
				destroyBodies( world, removedEntitiesQueue )
				removedEntitiesQueue.length = 0
			}

			step( rawWorld, deltaTimeInMs )

			incrementState( spell.entityManager, rawWorld, 1 / world.scale, this.bodies, transforms )
		}

		var Physics = function( spell ) {
			this.entityCreatedHandler
			this.entityDestroyHandler
			this.world
			this.removedEntitiesQueue = []
		}

		Physics.prototype = {
			init : init,
			destroy : destroy,
			activate : function( spell ) {},
			deactivate : function( spell ) {},
			process : process
		}

		return Physics
	}
)
